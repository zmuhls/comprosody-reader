import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useApp } from '../context/AppContext';
import {
  buildSelectionPrompt,
  buildSystemPrompt,
} from '../lib/prompts';
import { streamRefinement, generateVariantsApi } from '../lib/claude';
import {
  recordImprovementEvent,
  wordCount,
  type ImprovementOutcome,
} from '../lib/improvementMetrics';
import { selectTranscriptionHints } from '../lib/voiceProfile';
import type { RefinementMode, Variant } from '../types/llm';
import { VARIANT_TEMPERATURES } from '../constants';

const MAX_REQUEST_VOCABULARY_HINTS = 12;
const VOCABULARY_BOUNDARY = '[^\\p{L}\\p{N}]';

interface EntryActivation {
  entryId: string;
  activation: number;
}

interface ActiveEntryActivation {
  entryId: string | null;
  activation: number;
}

interface RefinementRequest extends EntryActivation {
  controller: AbortController;
}

interface VariantRequest extends EntryActivation {
  controller: AbortController;
}

interface VariantSet extends EntryActivation {
  variants: Variant[];
}

interface EntryRevisionSnapshot {
  rawTranscript: string;
  refinedText: string;
}

function normalizeVocabularyText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeWorkingText(value: string): string {
  return value.trim();
}

/**
 * A result may replace the document only when its exact request source is the
 * current edited body, or when the raw transcript is that source and the body
 * has not changed since the request began. This permits an editor debounce or
 * auto-refine append to settle without overwriting a newer writer edit.
 */
export function isDocumentRevisionCurrent(
  started: EntryRevisionSnapshot,
  current: EntryRevisionSnapshot | undefined,
  requestSource: string,
): boolean {
  if (!current) return false;

  const source = normalizeWorkingText(requestSource);
  const startedRefined = normalizeWorkingText(started.refinedText);
  const currentRaw = normalizeWorkingText(current.rawTranscript);
  const currentRefined = normalizeWorkingText(current.refinedText);

  if (currentRefined === source) return true;
  return (
    currentRaw === source &&
    (currentRefined === startedRefined || currentRefined === '')
  );
}

/**
 * Restricts locally learned casing hints to vocabulary already present in the
 * request. This keeps the voice profile useful without disclosing unrelated
 * vocabulary learned from other notes.
 */
export function selectRelevantVocabularyHints(
  vocabulary: readonly string[],
  requestText: string,
  limit = MAX_REQUEST_VOCABULARY_HINTS,
): string[] {
  const normalizedRequest = normalizeVocabularyText(requestText);
  if (!normalizedRequest || limit <= 0) return [];

  const selected: string[] = [];
  const seen = new Set<string>();

  for (const hint of vocabulary) {
    const normalizedHint = normalizeVocabularyText(hint);
    if (!normalizedHint || seen.has(normalizedHint)) continue;

    const pattern = new RegExp(
      `(?:^|${VOCABULARY_BOUNDARY})${escapeRegExp(normalizedHint)}(?=$|${VOCABULARY_BOUNDARY})`,
      'u',
    );
    if (!pattern.test(normalizedRequest)) continue;

    selected.push(hint.trim());
    seen.add(normalizedHint);
    if (selected.length >= limit) break;
  }

  return selected;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred';
}

function recordRefinementMetric({
  startedAt,
  outcome,
  mode,
  autoTriggered,
  sourceText,
  outputText,
}: {
  startedAt: number;
  outcome: ImprovementOutcome;
  mode: RefinementMode | 'selection' | 'variants';
  autoTriggered: boolean;
  sourceText: string;
  outputText?: string;
}): void {
  void recordImprovementEvent({
    eventType: 'refinement',
    outcome,
    provider: 'anthropic',
    mode,
    autoTriggered,
    durationMs: performance.now() - startedAt,
    inputUnits: wordCount(sourceText),
    outputUnits: outputText === undefined ? undefined : wordCount(outputText),
  });
}

export interface RefineDocumentOptions {
  mode?: RefinementMode;
  instruction?: string;
  sourceText?: string;
  entryId?: string;
  autoTriggered?: boolean;
}

export interface RefineSelectionOptions {
  selection: string;
  contextBefore: string;
  contextAfter: string;
  instruction?: string;
}

export function useRefinement() {
  const { state, dispatch, voiceProfile } = useApp();
  const [refinementRequest, setRefinementRequest] =
    useState<RefinementRequest | null>(null);
  const [variantSet, setVariantSet] = useState<VariantSet | null>(null);
  const [variantRequest, setVariantRequest] =
    useState<VariantRequest | null>(null);
  const [streamingResult, setStreamingResult] = useState<
    (EntryActivation & { text: string }) | null
  >(null);
  const refinementRequestRef = useRef<RefinementRequest | null>(null);
  const variantRequestRef = useRef<VariantRequest | null>(null);
  const entriesRef = useRef(state.entries);
  const activeEntryIdRef = useRef(state.activeEntryId);
  const activeEntryActivationRef = useRef(0);
  const [activeEntryActivation, setActiveEntryActivation] =
    useState<ActiveEntryActivation>({
      entryId: state.activeEntryId,
      activation: 0,
    });

  // A new activation invalidates selection coordinates and variants even when
  // the writer briefly switches away and then returns to the same note.
  if (activeEntryActivation.entryId !== state.activeEntryId) {
    setActiveEntryActivation({
      entryId: state.activeEntryId,
      activation: activeEntryActivation.activation + 1,
    });
  }

  useLayoutEffect(() => {
    entriesRef.current = state.entries;
    activeEntryIdRef.current = activeEntryActivation.entryId;
    activeEntryActivationRef.current = activeEntryActivation.activation;
  }, [activeEntryActivation, state.entries]);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  const learnedVocabulary = useMemo(() => {
    const vocabularyHints = selectTranscriptionHints(voiceProfile, {
      maxTerms: 30,
      maxPhrases: 10,
      minTermCount: 2,
      minPhraseCount: 2,
    });
    return [...vocabularyHints.terms, ...vocabularyHints.phrases];
  }, [voiceProfile]);

  const setError = useCallback(
    (message: string, type: 'refinement' | 'network' = 'refinement') => {
      dispatch({
        type: 'SET_ERROR',
        error: { id: crypto.randomUUID(), message, type },
      });
    },
    [dispatch],
  );

  const beginRequest = useCallback((entryId: string) => {
    refinementRequestRef.current?.controller.abort();
    const interruptedVariantRequest = variantRequestRef.current;
    interruptedVariantRequest?.controller.abort();
    if (interruptedVariantRequest) {
      variantRequestRef.current = null;
      setVariantRequest(null);
    }
    const controller = new AbortController();
    const request: RefinementRequest = {
      controller,
      entryId,
      activation:
        activeEntryIdRef.current === entryId
          ? activeEntryActivationRef.current
          : -1,
    };
    refinementRequestRef.current = request;
    setRefinementRequest(request);
    setStreamingResult({
      entryId: request.entryId,
      activation: request.activation,
      text: '',
    });
    return request;
  }, []);

  const finishRequest = useCallback((request: RefinementRequest) => {
    if (refinementRequestRef.current === request) {
      refinementRequestRef.current = null;
      setRefinementRequest(null);
      setStreamingResult(null);
    }
  }, []);

  useEffect(
    () => () => {
      refinementRequestRef.current?.controller.abort();
      variantRequestRef.current?.controller.abort();
    },
    [],
  );

  const refine = useCallback(
    async (options: RefineDocumentOptions = {}): Promise<string | null> => {
      const entry = options.entryId
        ? state.entries[options.entryId]
        : activeEntry;
      if (!entry) return null;

      const sourceText = (
        options.sourceText ??
        entry.refinedText ??
        entry.rawTranscript
      ).trim() || entry.rawTranscript.trim();
      if (!sourceText) return null;
      const startedRevision: EntryRevisionSnapshot = {
        rawTranscript: entry.rawTranscript,
        refinedText: entry.refinedText,
      };

      const mode = options.mode ?? state.refinementSettings.mode ?? 'faithful';
      const metricStartedAt = performance.now();
      const autoTriggered = options.autoTriggered === true;
      const systemPrompt = buildSystemPrompt(
        state.refinementSettings,
        entry.prosody,
        entry.voiceConfig,
        {
          mode,
          instruction: options.instruction,
          vocabularyHints: selectRelevantVocabularyHints(
            learnedVocabulary,
            sourceText,
          ),
        },
      );

      const request = beginRequest(entry.id);
      let result = '';

      try {
        for await (const chunk of streamRefinement({
          systemPrompt,
          userMessage: sourceText,
          temperature:
            mode === 'faithful'
              ? Math.min(state.refinementSettings.temperature, 0.35)
              : Math.max(state.refinementSettings.temperature, 0.35),
          signal: request.controller.signal,
        })) {
          result += chunk;
          if (refinementRequestRef.current === request) {
            setStreamingResult({
              entryId: request.entryId,
              activation: request.activation,
              text: result,
            });
          }
        }

        if (
          result.trim() &&
          refinementRequestRef.current === request &&
          isDocumentRevisionCurrent(
            startedRevision,
            entriesRef.current[entry.id],
            sourceText,
          )
        ) {
          dispatch({
            type: 'UPDATE_ENTRY',
            id: entry.id,
            updates: { refinedText: result.trim() },
            recordHistory: true,
          });
          recordRefinementMetric({
            startedAt: metricStartedAt,
            outcome: 'succeeded',
            mode,
            autoTriggered,
            sourceText,
            outputText: result,
          });
          return result.trim();
        }
        recordRefinementMetric({
          startedAt: metricStartedAt,
          outcome: result.trim() ? 'discarded' : 'failed',
          mode,
          autoTriggered,
          sourceText,
          outputText: result.trim() || undefined,
        });
        return null;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          recordRefinementMetric({
            startedAt: metricStartedAt,
            outcome: 'cancelled',
            mode,
            autoTriggered,
            sourceText,
          });
          return null;
        }
        recordRefinementMetric({
          startedAt: metricStartedAt,
          outcome: 'failed',
          mode,
          autoTriggered,
          sourceText,
        });
        console.error('Refinement failed:', error);
        setError(formatError(error));
        return null;
      } finally {
        finishRequest(request);
      }
    },
    [
      activeEntry,
      beginRequest,
      dispatch,
      finishRequest,
      learnedVocabulary,
      setError,
      state.entries,
      state.refinementSettings,
    ],
  );

  const refineSelection = useCallback(
    async (options: RefineSelectionOptions): Promise<string | null> => {
      if (!activeEntry || !options.selection.trim()) return null;

      const originEntryId = activeEntry.id;
      const originActivation = activeEntryActivationRef.current;
      const metricStartedAt = performance.now();
      const requestVocabulary = selectRelevantVocabularyHints(
        learnedVocabulary,
        [options.contextBefore, options.selection, options.contextAfter].join('\n'),
      );

      const { system, user } = buildSelectionPrompt(
        state.refinementSettings,
        activeEntry.prosody,
        activeEntry.voiceConfig,
        options.contextBefore,
        options.selection,
        options.contextAfter,
        {
          mode: 'faithful',
          instruction: options.instruction,
          vocabularyHints: requestVocabulary,
        },
      );

      const request = beginRequest(originEntryId);
      let result = '';

      try {
        for await (const chunk of streamRefinement({
          systemPrompt: system,
          userMessage: user,
          temperature: Math.min(state.refinementSettings.temperature, 0.35),
          signal: request.controller.signal,
        })) {
          result += chunk;
          if (refinementRequestRef.current === request) {
            setStreamingResult({
              entryId: request.entryId,
              activation: request.activation,
              text: result,
            });
          }
        }

        if (
          refinementRequestRef.current !== request ||
          activeEntryIdRef.current !== originEntryId ||
          activeEntryActivationRef.current !== originActivation
        ) {
          recordRefinementMetric({
            startedAt: metricStartedAt,
            outcome: 'discarded',
            mode: 'selection',
            autoTriggered: false,
            sourceText: options.selection,
            outputText: result.trim() || undefined,
          });
          return null;
        }
        const output = result.trim();
        recordRefinementMetric({
          startedAt: metricStartedAt,
          outcome: output ? 'succeeded' : 'failed',
          mode: 'selection',
          autoTriggered: false,
          sourceText: options.selection,
          outputText: output || undefined,
        });
        return output || null;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          recordRefinementMetric({
            startedAt: metricStartedAt,
            outcome: 'cancelled',
            mode: 'selection',
            autoTriggered: false,
            sourceText: options.selection,
          });
          return null;
        }
        recordRefinementMetric({
          startedAt: metricStartedAt,
          outcome: 'failed',
          mode: 'selection',
          autoTriggered: false,
          sourceText: options.selection,
        });
        console.error('Selection refinement failed:', error);
        setError(formatError(error));
        return null;
      } finally {
        finishRequest(request);
      }
    },
    [
      activeEntry,
      beginRequest,
      finishRequest,
      learnedVocabulary,
      setError,
      state.refinementSettings,
    ],
  );

  const generateVariants = useCallback(async () => {
    if (!activeEntry || refinementRequestRef.current) return;

    const originEntryId = activeEntry.id;
    const originActivation = activeEntryActivationRef.current;
    if (activeEntryIdRef.current !== originEntryId) return;

    const sourceText = activeEntry.refinedText || activeEntry.rawTranscript;
    if (!sourceText.trim()) return;
    const metricStartedAt = performance.now();
    const systemPrompt = buildSystemPrompt(
      state.refinementSettings,
      activeEntry.prosody,
      activeEntry.voiceConfig,
      {
        mode: 'faithful',
        vocabularyHints: selectRelevantVocabularyHints(
          learnedVocabulary,
          sourceText,
        ),
      },
    );

    variantRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const request: VariantRequest = {
      controller,
      entryId: originEntryId,
      activation: originActivation,
    };
    variantRequestRef.current = request;
    setVariantRequest(request);
    setVariantSet(null);

    try {
      const results = await generateVariantsApi({
        systemPrompt,
        userMessage: sourceText,
        temperatures: VARIANT_TEMPERATURES.map(({ label, temperature }) => ({
          label,
          temperature,
        })),
        signal: controller.signal,
      });
      if (
        variantRequestRef.current === request &&
        !request.controller.signal.aborted &&
        activeEntryIdRef.current === originEntryId &&
        activeEntryActivationRef.current === originActivation
      ) {
        setVariantSet({
          entryId: originEntryId,
          activation: originActivation,
          variants: results as Variant[],
        });
        recordRefinementMetric({
          startedAt: metricStartedAt,
          outcome: results.length ? 'succeeded' : 'failed',
          mode: 'variants',
          autoTriggered: false,
          sourceText,
          outputText: results.map(({ text }) => text).join(' '),
        });
      } else {
        recordRefinementMetric({
          startedAt: metricStartedAt,
          outcome: 'discarded',
          mode: 'variants',
          autoTriggered: false,
          sourceText,
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        recordRefinementMetric({
          startedAt: metricStartedAt,
          outcome: 'cancelled',
          mode: 'variants',
          autoTriggered: false,
          sourceText,
        });
        return;
      }
      recordRefinementMetric({
        startedAt: metricStartedAt,
        outcome: 'failed',
        mode: 'variants',
        autoTriggered: false,
        sourceText,
      });
      console.error('Variant generation failed:', error);
      setError(formatError(error));
    } finally {
      if (variantRequestRef.current === request) {
        variantRequestRef.current = null;
        setVariantRequest(null);
      }
    }
  }, [
    activeEntry,
    learnedVocabulary,
    setError,
    state.refinementSettings,
  ]);

  const acceptVariant = useCallback(
    (variant: Variant) => {
      if (
        !variantSet ||
        variantSet.entryId !== activeEntryIdRef.current ||
        variantSet.activation !== activeEntryActivationRef.current ||
        !variantSet.variants.includes(variant)
      ) {
        return;
      }
      dispatch({
        type: 'UPDATE_ENTRY',
        id: variantSet.entryId,
        updates: { refinedText: variant.text },
      });
      setVariantSet(null);
    },
    [dispatch, variantSet],
  );

  const cancel = useCallback(() => {
    refinementRequestRef.current?.controller.abort();
    variantRequestRef.current?.controller.abort();
  }, []);

  const isCurrentActivation = useCallback(
    (activation: EntryActivation | null) =>
      Boolean(
          activation &&
          activation.entryId === state.activeEntryId &&
          activation.activation === activeEntryActivation.activation,
      ),
    [activeEntryActivation, state.activeEntryId],
  );

  const variants = isCurrentActivation(variantSet) ? variantSet!.variants : [];
  const isRefining = isCurrentActivation(refinementRequest);
  const isGeneratingVariants = isCurrentActivation(variantRequest);
  const streamingText = isCurrentActivation(streamingResult)
    ? streamingResult!.text
    : '';

  return {
    isRefining,
    refine,
    refineSelection,
    variants,
    isGeneratingVariants,
    generateVariants,
    acceptVariant,
    streamingText,
    cancel,
  };
}

export type RefinementController = ReturnType<typeof useRefinement>;
