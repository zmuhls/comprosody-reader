import { useState, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { buildSystemPrompt, buildSelectionPrompt } from '../lib/prompts';
import { streamRefinement, generateVariantsApi } from '../lib/claude';
import type { Variant } from '../types/llm';
import { VARIANT_TEMPERATURES } from '../constants';

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : 'An unexpected error occurred';
}

export function useRefinement() {
  const { state, dispatch } = useApp();
  const [isRefining, setIsRefining] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  const setError = useCallback(
    (message: string, type: 'refinement' | 'network' = 'refinement') => {
      dispatch({
        type: 'SET_ERROR',
        error: { id: crypto.randomUUID(), message, type },
      });
    },
    [dispatch]
  );

  const refine = useCallback(async () => {
    if (!activeEntry) return;

    const systemPrompt = buildSystemPrompt(
      state.refinementSettings,
      activeEntry.prosody,
      activeEntry.voiceConfig
    );

    setIsRefining(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    let result = '';

    try {
      for await (const chunk of streamRefinement({
        systemPrompt,
        userMessage: activeEntry.rawTranscript,
        temperature: state.refinementSettings.temperature,
        signal: abortRef.current.signal,
      })) {
        result += chunk;
        // Update local state only — avoids re-rendering all AppContext consumers per token
        setStreamingText(result);
      }
      // Single dispatch to context after streaming completes
      if (result) {
        dispatch({
          type: 'UPDATE_ENTRY',
          id: activeEntry.id,
          updates: { refinedText: result },
          recordHistory: true,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Refinement failed:', err);
      setError(formatError(err));
    } finally {
      setStreamingText('');
      setIsRefining(false);
      abortRef.current = null;
    }
  }, [activeEntry, state.refinementSettings, dispatch, setError]);

  const refineSelection = useCallback(
    async (selectionStart: number, selectionEnd: number) => {
      if (!activeEntry) return;

      const text = activeEntry.refinedText || activeEntry.rawTranscript;
      const selection = text.slice(selectionStart, selectionEnd);
      if (!selection.trim()) return;

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
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      let refined = '';

      try {
        for await (const chunk of streamRefinement({
          systemPrompt: system,
          userMessage: user,
          temperature: state.refinementSettings.temperature,
          signal: abortRef.current.signal,
        })) {
          refined += chunk;
          // Show selection refinement in progress via local streaming state
          setStreamingText(
            text.slice(0, selectionStart) + refined + text.slice(selectionEnd)
          );
        }

        const newText =
          text.slice(0, selectionStart) + refined + text.slice(selectionEnd);
        dispatch({
          type: 'UPDATE_ENTRY',
          id: activeEntry.id,
          updates: { refinedText: newText },
          recordHistory: true,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Selection refinement failed:', err);
        setError(formatError(err));
      } finally {
        setStreamingText('');
        setIsRefining(false);
        abortRef.current = null;
      }
    },
    [activeEntry, state.refinementSettings, dispatch, setError]
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
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const results = await generateVariantsApi({
        systemPrompt,
        userMessage: activeEntry.rawTranscript,
        temperatures: VARIANT_TEMPERATURES.map(({ label, temperature }) => ({
          label,
          temperature,
        })),
        signal: abortRef.current.signal,
      });
      setVariants(results as Variant[]);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Variant generation failed:', err);
      setError(formatError(err));
    } finally {
      setIsGeneratingVariants(false);
      abortRef.current = null;
    }
  }, [activeEntry, state.refinementSettings, setError]);

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
    streamingText,
  };
}