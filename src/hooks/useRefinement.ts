import { useState, useCallback, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { buildSystemPrompt, buildSelectionPrompt } from '../lib/prompts';
import { buildRefineContext } from '../lib/refineContext';
import { streamRefinement, generateVariantsApi } from '../lib/claude';
import type { Variant, VariantError } from '../types/llm';
import type { Entry } from '../types/editor';
import { VARIANT_TEMPERATURES } from '../constants';

const DRAFT_HISTORY_CAP = 10;

function pushDraftHistory(entry: Entry, nextText: string): string[] | undefined {
  const current = entry.refinedText;
  if (!current.trim() || current === nextText) return undefined;
  return [...(entry.draftHistory ?? []), current].slice(-DRAFT_HISTORY_CAP);
}

export function useRefinement() {
  const { state, dispatch } = useApp();
  const [isRefining, setIsRefining] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [variantErrors, setVariantErrors] = useState<VariantError[]>([]);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [refinementError, setRefinementError] = useState<string | null>(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  useEffect(() => {
    setVariants([]);
    setVariantErrors([]);
    setRefinementError(null);
  }, [activeEntry?.id]);

  const refine = useCallback(async () => {
    if (!activeEntry) return;
    if (!activeEntry.rawTranscript.trim()) {
      setRefinementError('Record or edit a transcript before refining.');
      return;
    }

    const systemPrompt = buildSystemPrompt(
      state.refinementSettings,
      activeEntry.prosody,
      activeEntry.voiceConfig,
      buildRefineContext(activeEntry.id, stateRef.current.entries, stateRef.current.directories)
    );

    setIsRefining(true);
    setRefinementError(null);
    let result = '';
    let history = pushDraftHistory(activeEntry, '');

    try {
      for await (const chunk of streamRefinement({
        systemPrompt,
        userMessage: activeEntry.rawTranscript,
        temperature: state.refinementSettings.temperature,
      })) {
        result += chunk;
        if (history) {
          dispatch({
            type: 'UPDATE_ENTRY',
            id: activeEntry.id,
            updates: { refinedText: result, draftHistory: history },
          });
          history = undefined;
        } else {
          dispatch({
            type: 'UPDATE_ENTRY',
            id: activeEntry.id,
            updates: { refinedText: result },
          });
        }
      }
    } catch (err) {
      setRefinementError(
        err instanceof Error ? err.message : 'Refinement failed'
      );
      console.error('Refinement failed:', err);
    } finally {
      setIsRefining(false);
    }
  }, [activeEntry, state.refinementSettings, dispatch]);

  const refineSelection = useCallback(
    async (selectionStart: number, selectionEnd: number) => {
      if (!activeEntry) return;

      const text = activeEntry.refinedText;
      const selection = text.slice(selectionStart, selectionEnd);
      if (!selection.trim()) {
        setRefinementError('Select text in the draft pane before refining a fragment.');
        return;
      }

      // Get surrounding context (one sentence before/after)
      const beforeText = text.slice(0, selectionStart);
      const afterText = text.slice(selectionEnd);
      const contextBefore =
        beforeText.split(/[.!?]\s/).slice(-1)[0] || beforeText.slice(-200);
      const contextAfter =
        afterText.split(/[.!?]\s/)[0] || afterText.slice(0, 200);

      const { system, user } = buildSelectionPrompt(
        state.refinementSettings,
        activeEntry.prosody,
        activeEntry.voiceConfig,
        contextBefore,
        selection,
        contextAfter,
        buildRefineContext(activeEntry.id, stateRef.current.entries, stateRef.current.directories)
      );

      setIsRefining(true);
      setRefinementError(null);
      let refined = '';

      try {
        for await (const chunk of streamRefinement({
          systemPrompt: system,
          userMessage: user,
          temperature: state.refinementSettings.temperature,
        })) {
          refined += chunk;
        }

        // Guard against the draft mutating while the stream was in flight —
        // the captured offsets would splice into the wrong place.
        const currentEntry = stateRef.current.entries[activeEntry.id];
        if (
          !currentEntry ||
          currentEntry.refinedText.slice(selectionStart, selectionEnd) !==
            selection
        ) {
          setRefinementError('selection changed during refinement');
          return;
        }

        const currentText = currentEntry.refinedText;
        const newText =
          currentText.slice(0, selectionStart) +
          refined +
          currentText.slice(selectionEnd);
        const history = pushDraftHistory(currentEntry, newText);
        dispatch({
          type: 'UPDATE_ENTRY',
          id: activeEntry.id,
          updates: history
            ? { refinedText: newText, draftHistory: history }
            : { refinedText: newText },
        });
      } catch (err) {
        setRefinementError(
          err instanceof Error ? err.message : 'Selection refinement failed'
        );
        console.error('Selection refinement failed:', err);
      } finally {
        setIsRefining(false);
      }
    },
    [activeEntry, state.refinementSettings, dispatch]
  );

  const generateVariants = useCallback(async () => {
    if (!activeEntry) return;
    if (!activeEntry.rawTranscript.trim()) {
      setRefinementError('Variants need transcript text to work from.');
      return;
    }

    const systemPrompt = buildSystemPrompt(
      state.refinementSettings,
      activeEntry.prosody,
      activeEntry.voiceConfig,
      buildRefineContext(activeEntry.id, stateRef.current.entries, stateRef.current.directories)
    );

    setIsGeneratingVariants(true);
    setVariants([]);
    setVariantErrors([]);
    setRefinementError(null);

    try {
      const { variants: results, errors } = await generateVariantsApi({
        systemPrompt,
        userMessage: activeEntry.rawTranscript,
        temperatures: VARIANT_TEMPERATURES.map(({ label, temperature }) => ({
          label,
          temperature,
        })),
      });
      if (results.length === 0) {
        setRefinementError(errors[0]?.error ?? 'Variant generation failed');
        return;
      }
      setVariants(results);
      setVariantErrors(errors);
    } catch (err) {
      setRefinementError(
        err instanceof Error ? err.message : 'Variant generation failed'
      );
      console.error('Variant generation failed:', err);
    } finally {
      setIsGeneratingVariants(false);
    }
  }, [activeEntry, state.refinementSettings]);

  const acceptVariant = useCallback(
    (variant: Variant) => {
      if (!activeEntry) return;
      const history = pushDraftHistory(activeEntry, variant.text);
      dispatch({
        type: 'UPDATE_ENTRY',
        id: activeEntry.id,
        updates: history
          ? { refinedText: variant.text, draftHistory: history }
          : { refinedText: variant.text },
      });
      setVariants([]);
      setVariantErrors([]);
    },
    [activeEntry, dispatch]
  );

  /** Re-run a single failed pass and merge it back into the set. */
  const retryVariant = useCallback(
    async (label: Variant['label']) => {
      if (!activeEntry) return;
      const spec = VARIANT_TEMPERATURES.find((t) => t.label === label);
      if (!spec) return;

      const systemPrompt = buildSystemPrompt(
        state.refinementSettings,
        activeEntry.prosody,
        activeEntry.voiceConfig,
        buildRefineContext(activeEntry.id, stateRef.current.entries, stateRef.current.directories)
      );

      const chipOrder = (l: Variant['label']) =>
        VARIANT_TEMPERATURES.findIndex((t) => t.label === l);

      setIsGeneratingVariants(true);
      setRefinementError(null);
      try {
        const { variants: results, errors } = await generateVariantsApi({
          systemPrompt,
          userMessage: activeEntry.rawTranscript,
          temperatures: [{ label: spec.label, temperature: spec.temperature }],
        });
        setVariants((prev) =>
          [...prev.filter((v) => v.label !== label), ...results].sort(
            (a, b) => chipOrder(a.label) - chipOrder(b.label)
          )
        );
        setVariantErrors((prev) => [
          ...prev.filter((e) => e.label !== label),
          ...errors,
        ]);
      } catch (err) {
        setRefinementError(
          err instanceof Error ? err.message : 'Variant retry failed'
        );
        console.error('Variant retry failed:', err);
      } finally {
        setIsGeneratingVariants(false);
      }
    },
    [activeEntry, state.refinementSettings]
  );

  const dismissVariants = useCallback(() => {
    setVariants([]);
    setVariantErrors([]);
  }, []);

  return {
    isRefining,
    refinementError,
    refine,
    refineSelection,
    variants,
    variantErrors,
    isGeneratingVariants,
    generateVariants,
    acceptVariant,
    retryVariant,
    dismissVariants,
  };
}
