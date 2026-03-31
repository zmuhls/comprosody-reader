import { useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { buildSystemPrompt, buildSelectionPrompt } from '../lib/prompts';
import { streamRefinement, generateVariantsApi } from '../lib/claude';
import type { Variant } from '../types/llm';
import { VARIANT_TEMPERATURES } from '../constants';

export function useRefinement() {
  const { state, dispatch } = useApp();
  const [isRefining, setIsRefining] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  const refine = useCallback(async () => {
    if (!activeEntry) return;

    const systemPrompt = buildSystemPrompt(
      state.refinementSettings,
      activeEntry.prosody,
      activeEntry.voiceConfig
    );

    setIsRefining(true);
    let result = '';

    try {
      for await (const chunk of streamRefinement({
        systemPrompt,
        userMessage: activeEntry.rawTranscript,
        temperature: state.refinementSettings.temperature,
      })) {
        result += chunk;
        dispatch({
          type: 'UPDATE_ENTRY',
          id: activeEntry.id,
          updates: { refinedText: result },
        });
      }
    } catch (err) {
      console.error('Refinement failed:', err);
    } finally {
      setIsRefining(false);
    }
  }, [activeEntry, state.refinementSettings, dispatch]);

  const refineSelection = useCallback(
    async (selectionStart: number, selectionEnd: number) => {
      if (!activeEntry) return;

      const text = activeEntry.refinedText || activeEntry.rawTranscript;
      const selection = text.slice(selectionStart, selectionEnd);
      if (!selection.trim()) return;

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
        contextAfter
      );

      setIsRefining(true);
      let refined = '';

      try {
        for await (const chunk of streamRefinement({
          systemPrompt: system,
          userMessage: user,
          temperature: state.refinementSettings.temperature,
        })) {
          refined += chunk;
        }

        // Splice refined text back in
        const newText =
          text.slice(0, selectionStart) + refined + text.slice(selectionEnd);
        dispatch({
          type: 'UPDATE_ENTRY',
          id: activeEntry.id,
          updates: { refinedText: newText },
        });
      } catch (err) {
        console.error('Selection refinement failed:', err);
      } finally {
        setIsRefining(false);
      }
    },
    [activeEntry, state.refinementSettings, dispatch]
  );

  const generateVariants = useCallback(async () => {
    if (!activeEntry) return;

    const systemPrompt = buildSystemPrompt(
      state.refinementSettings,
      activeEntry.prosody,
      activeEntry.voiceConfig
    );

    setIsGeneratingVariants(true);
    setVariants([]);

    try {
      const results = await generateVariantsApi({
        systemPrompt,
        userMessage: activeEntry.rawTranscript,
        temperatures: VARIANT_TEMPERATURES.map(({ label, temperature }) => ({
          label,
          temperature,
        })),
      });
      setVariants(results as Variant[]);
    } catch (err) {
      console.error('Variant generation failed:', err);
    } finally {
      setIsGeneratingVariants(false);
    }
  }, [activeEntry, state.refinementSettings]);

  const acceptVariant = useCallback(
    (variant: Variant) => {
      if (!activeEntry) return;
      dispatch({
        type: 'UPDATE_ENTRY',
        id: activeEntry.id,
        updates: { refinedText: variant.text },
      });
      setVariants([]);
    },
    [activeEntry, dispatch]
  );

  return {
    isRefining,
    refine,
    refineSelection,
    variants,
    isGeneratingVariants,
    generateVariants,
    acceptVariant,
  };
}
