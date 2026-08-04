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
import { streamRefinement, generateVariantsApi } from '../lib/refinementApi';
import { buildRefineContext } from '../lib/refineContext';
import {
  recordImprovementEvent,
  wordCount,
  type ImprovementOutcome,
} from '../lib/improvementMetrics';
import { selectTranscriptionHints } from '../lib/voiceProfile';
import type { RefinementMode, Variant, VariantError } from '../types/llm';
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
  proposalId: string;
}

interface VariantRequest extends EntryActivation {
  controller: AbortController;
}

interface VariantSet extends EntryActivation {
  variants: Variant[];
  errors: VariantError[];
  sourceText: string;
  startedRevision: EntryRevisionSnapshot;
}

export interface EntryRevisionSnapshot {
  rawTranscript: string;
  refinedText: string;
}

export type RefinementProposalStatus =
  | 'streaming'
  | 'ready'
  | 'rejected'
  | 'stale'
  | 'failed';

export interface RefinementSelectionTarget {
  contextAfter: string;
  contextBefore: string;
  documentText: string;
  from: number;
  selection: string;
  to: number;
}

export interface RefinementProposal extends EntryActivation {
  autoTriggered: boolean;
  error?: string;
  id: string;
  instruction?: string;
  mode: RefinementMode | 'selection' | 'variants';
  selectionTarget?: RefinementSelectionTarget;
  sourceText: string;
  startedAt: number;
  startedRevision: EntryRevisionSnapshot;
  status: RefinementProposalStatus;
  text: string;
}

export interface RefinementAttempt extends EntryActivation {
  autoTriggered: boolean;
  id: string;
  instruction?: string;
  mode: RefinementProposal['mode'];
  status: Exclude<RefinementProposalStatus, 'streaming'> | 'accepted';
  text: string;
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
    provider: 'ollama',
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
  documentText?: string;
  from?: number;
  to?: number;
}

export interface RefinementRetryContext {
  documentText: string;
  selection?: RefineSelectionOptions;
}

const MAX_ATTEMPTS = 6;
const MAX_RETRY_GUIDANCE = 800;
const MAX_REJECTED_CANDIDATE_CONTEXT = 6_000;

export function useRefinement() {
  const { state, dispatch, voiceProfile } = useApp();
  const [refinementRequest, setRefinementRequest] =
    useState<RefinementRequest | null>(null);
  const [variantSet, setVariantSet] = useState<VariantSet | null>(null);
  const [variantRequest, setVariantRequest] =
    useState<VariantRequest | null>(null);
  const [proposal, setProposal] = useState<RefinementProposal | null>(null);
  const [attempts, setAttempts] = useState<RefinementAttempt[]>([]);
  const refinementRequestRef = useRef<RefinementRequest | null>(null);
  const variantRequestRef = useRef<VariantRequest | null>(null);
  const proposalRef = useRef<RefinementProposal | null>(null);
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

  const publishProposal = useCallback(
    (next: RefinementProposal | null) => {
      proposalRef.current = next;
      setProposal(next);
    },
    [],
  );

  const archiveProposal = useCallback((current: RefinementProposal | null) => {
    if (!current || current.status === 'streaming') return;
    const archived: RefinementAttempt = {
      activation: current.activation,
      autoTriggered: current.autoTriggered,
      entryId: current.entryId,
      id: current.id,
      instruction: current.instruction,
      mode: current.mode,
      status: current.status,
      text: current.text,
    };
    setAttempts((previous) => [
      ...previous.filter((attempt) => attempt.id !== current.id),
      archived,
    ].slice(-MAX_ATTEMPTS));
  }, []);

  const beginRequest = useCallback(
    (
      entryId: string,
      details: Omit<
        RefinementProposal,
        'activation' | 'entryId' | 'id' | 'status' | 'text'
      >,
    ) => {
      refinementRequestRef.current?.controller.abort();
      const interruptedVariantRequest = variantRequestRef.current;
      interruptedVariantRequest?.controller.abort();
      if (interruptedVariantRequest) {
        variantRequestRef.current = null;
        setVariantRequest(null);
      }
      archiveProposal(proposalRef.current);
      const controller = new AbortController();
      const activation =
        activeEntryIdRef.current === entryId
          ? activeEntryActivationRef.current
          : -1;
      const proposalId = crypto.randomUUID();
      const request: RefinementRequest = {
        controller,
        entryId,
        activation,
        proposalId,
      };
      const nextProposal: RefinementProposal = {
        ...details,
        activation,
        entryId,
        id: proposalId,
        status: 'streaming',
        text: '',
      };
      refinementRequestRef.current = request;
      setRefinementRequest(request);
      publishProposal(nextProposal);
      return request;
    },
    [archiveProposal, publishProposal],
  );

  const finishRequest = useCallback((request: RefinementRequest) => {
    if (refinementRequestRef.current === request) {
      refinementRequestRef.current = null;
      setRefinementRequest(null);
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
          refineContext: buildRefineContext(
            entry.id,
            state.entries,
            state.directories,
          ),
        },
      );

      const request = beginRequest(entry.id, {
        autoTriggered,
        instruction: options.instruction?.trim() || undefined,
        mode,
        sourceText,
        startedAt: metricStartedAt,
        startedRevision,
      });
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
          const currentProposal = proposalRef.current;
          if (
            refinementRequestRef.current === request &&
            currentProposal?.id === request.proposalId
          ) {
            publishProposal({ ...currentProposal, text: result });
          }
        }

        const output = result.trim();
        const currentProposal = proposalRef.current;
        if (
          refinementRequestRef.current !== request ||
          currentProposal?.id !== request.proposalId
        ) {
          return null;
        }
        if (!output) {
          publishProposal({
            ...currentProposal,
            error: 'The model returned no proposed text.',
            status: 'failed',
            text: '',
          });
          recordRefinementMetric({
            startedAt: metricStartedAt,
            outcome: 'failed',
            mode,
            autoTriggered,
            sourceText,
          });
          return null;
        }

        const isCurrent =
          request.entryId === activeEntryIdRef.current &&
          request.activation === activeEntryActivationRef.current &&
          isDocumentRevisionCurrent(
            startedRevision,
            entriesRef.current[entry.id],
            sourceText,
          );
        publishProposal({
          ...currentProposal,
          status: isCurrent ? 'ready' : 'stale',
          text: output,
        });
        return isCurrent ? output : null;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          const currentProposal = proposalRef.current;
          if (currentProposal?.id === request.proposalId) {
            publishProposal({
              ...currentProposal,
              error: 'Generation stopped. Your note was not changed.',
              status: 'failed',
              text: result.trim(),
            });
          }
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
        const currentProposal = proposalRef.current;
        if (currentProposal?.id === request.proposalId) {
          publishProposal({
            ...currentProposal,
            error: formatError(error),
            status: 'failed',
            text: result.trim(),
          });
        }
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
      publishProposal,
      setError,
      state.directories,
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
          refineContext: buildRefineContext(
            activeEntry.id,
            state.entries,
            state.directories,
          ),
        },
      );

      const request = beginRequest(originEntryId, {
        autoTriggered: false,
        instruction: options.instruction?.trim() || undefined,
        mode: 'selection',
        selectionTarget: {
          contextAfter: options.contextAfter,
          contextBefore: options.contextBefore,
          documentText:
            options.documentText ??
            activeEntry.refinedText ??
            activeEntry.rawTranscript,
          from: options.from ?? -1,
          selection: options.selection,
          to: options.to ?? -1,
        },
        sourceText: options.selection,
        startedAt: metricStartedAt,
        startedRevision: {
          rawTranscript: activeEntry.rawTranscript,
          refinedText: activeEntry.refinedText,
        },
      });
      let result = '';

      try {
        for await (const chunk of streamRefinement({
          systemPrompt: system,
          userMessage: user,
          temperature: Math.min(state.refinementSettings.temperature, 0.35),
          signal: request.controller.signal,
        })) {
          result += chunk;
          const currentProposal = proposalRef.current;
          if (
            refinementRequestRef.current === request &&
            currentProposal?.id === request.proposalId
          ) {
            publishProposal({ ...currentProposal, text: result });
          }
        }

        const output = result.trim();
        const currentProposal = proposalRef.current;
        if (
          refinementRequestRef.current !== request ||
          currentProposal?.id !== request.proposalId
        ) {
          return null;
        }
        if (!output) {
          publishProposal({
            ...currentProposal,
            error: 'The model returned no proposed text.',
            status: 'failed',
            text: '',
          });
          recordRefinementMetric({
            startedAt: metricStartedAt,
            outcome: 'failed',
            mode: 'selection',
            autoTriggered: false,
            sourceText: options.selection,
          });
          return null;
        }
        const currentEntry = entriesRef.current[originEntryId];
        const currentDocument = currentEntry
          ? currentEntry.refinedText || currentEntry.rawTranscript
          : '';
        const isCurrent =
          activeEntryIdRef.current === originEntryId &&
          activeEntryActivationRef.current === originActivation &&
          normalizeWorkingText(currentDocument) ===
            normalizeWorkingText(
              currentProposal.selectionTarget?.documentText ?? '',
            );
        publishProposal({
          ...currentProposal,
          status: isCurrent ? 'ready' : 'stale',
          text: output,
        });
        return isCurrent ? output : null;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          const currentProposal = proposalRef.current;
          if (currentProposal?.id === request.proposalId) {
            publishProposal({
              ...currentProposal,
              error: 'Generation stopped. Your note was not changed.',
              status: 'failed',
              text: result.trim(),
            });
          }
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
        const currentProposal = proposalRef.current;
        if (currentProposal?.id === request.proposalId) {
          publishProposal({
            ...currentProposal,
            error: formatError(error),
            status: 'failed',
            text: result.trim(),
          });
        }
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
      publishProposal,
      setError,
      state.directories,
      state.entries,
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
        refineContext: buildRefineContext(
          activeEntry.id,
          state.entries,
          state.directories,
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
      const { variants: results, errors } = await generateVariantsApi({
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
          sourceText,
          startedRevision: {
            rawTranscript: activeEntry.rawTranscript,
            refinedText: activeEntry.refinedText,
          },
          variants: results as Variant[],
          errors,
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
    state.directories,
    state.entries,
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
      archiveProposal(proposalRef.current);
      publishProposal({
        activation: variantSet.activation,
        autoTriggered: false,
        entryId: variantSet.entryId,
        id: crypto.randomUUID(),
        instruction: `Generated ${variant.label} variant`,
        mode: 'variants',
        sourceText: variantSet.sourceText,
        startedAt: performance.now(),
        startedRevision: variantSet.startedRevision,
        status: isDocumentRevisionCurrent(
          variantSet.startedRevision,
          entriesRef.current[variantSet.entryId],
          variantSet.sourceText,
        )
          ? 'ready'
          : 'stale',
        text: variant.text,
      });
      setVariantSet(null);
    },
    [archiveProposal, publishProposal, variantSet],
  );

  const acceptProposal = useCallback(
    (
      applyCandidate?: (candidate: RefinementProposal) => boolean,
    ): boolean => {
      const current = proposalRef.current;
      if (!current || current.status !== 'ready') return false;

      const isCurrentActivation =
        current.entryId === activeEntryIdRef.current &&
        current.activation === activeEntryActivationRef.current;
      let applied = false;

      if (isCurrentActivation && applyCandidate) {
        applied = applyCandidate(current) === true;
      } else if (
        isCurrentActivation &&
        !current.selectionTarget &&
        isDocumentRevisionCurrent(
          current.startedRevision,
          entriesRef.current[current.entryId],
          current.sourceText,
        )
      ) {
        dispatch({
          type: 'UPDATE_ENTRY',
          id: current.entryId,
          updates: { refinedText: current.text },
          recordHistory: true,
        });
        applied = true;
      }

      if (!applied) {
        publishProposal({
          ...current,
          error:
            'This note changed after the proposal began. Retry against the current text.',
          status: 'stale',
        });
        return false;
      }

      recordRefinementMetric({
        startedAt: current.startedAt,
        outcome: 'succeeded',
        mode: current.mode,
        autoTriggered: current.autoTriggered,
        sourceText: current.sourceText,
        outputText: current.text,
      });
      const acceptedAttempt: RefinementAttempt = {
        activation: current.activation,
        autoTriggered: current.autoTriggered,
        entryId: current.entryId,
        id: current.id,
        instruction: current.instruction,
        mode: current.mode,
        status: 'accepted',
        text: current.text,
      };
      setAttempts((previous) => [
        ...previous.filter((attempt) => attempt.id !== current.id),
        acceptedAttempt,
      ].slice(-MAX_ATTEMPTS));
      publishProposal(null);
      return true;
    },
    [dispatch, publishProposal],
  );

  const rejectProposal = useCallback((): boolean => {
    const current = proposalRef.current;
    if (
      !current ||
      current.status === 'streaming' ||
      current.status === 'rejected'
    ) {
      return false;
    }
    recordRefinementMetric({
      startedAt: current.startedAt,
      outcome: 'discarded',
      mode: current.mode,
      autoTriggered: current.autoTriggered,
      sourceText: current.sourceText,
      outputText: current.text || undefined,
    });
    publishProposal({
      ...current,
      error: undefined,
      status: 'rejected',
    });
    return true;
  }, [publishProposal]);

  const retryProposal = useCallback(
    async (
      guidance: string,
      context?: RefinementRetryContext,
    ): Promise<string | null> => {
      const current = proposalRef.current;
      const writerGuidance = guidance.trim().slice(0, MAX_RETRY_GUIDANCE);
      if (
        !current ||
        current.status === 'streaming' ||
        !writerGuidance ||
        current.entryId !== activeEntryIdRef.current ||
        current.activation !== activeEntryActivationRef.current
      ) {
        return null;
      }

      if (
        current.status !== 'rejected' &&
        current.status !== 'failed'
      ) {
        recordRefinementMetric({
          startedAt: current.startedAt,
          outcome: 'discarded',
          mode: current.mode,
          autoTriggered: current.autoTriggered,
          sourceText: current.sourceText,
          outputText: current.text || undefined,
        });
        publishProposal({ ...current, status: 'rejected' });
      }

      const originalInstruction = current.instruction
        ?.trim()
        .slice(0, MAX_RETRY_GUIDANCE);
      const retryInstruction = [
        originalInstruction
          ? `Original writer instruction: ${originalInstruction}`
          : '',
        current.text.trim()
          ? `The writer rejected this previous proposal:\n${current.text
              .trim()
              .slice(0, MAX_REJECTED_CANDIDATE_CONTEXT)}`
          : '',
        `Writer guidance for the next proposal: ${writerGuidance}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const currentEntry = entriesRef.current[current.entryId];
      const currentDocumentText = (
        context?.documentText ??
        currentEntry?.refinedText ??
        currentEntry?.rawTranscript ??
        ''
      ).trim();
      if (!currentDocumentText) return null;

      if (current.selectionTarget) {
        const selection =
          context?.selection ??
          (current.selectionTarget.documentText.trim() === currentDocumentText
            ? current.selectionTarget
            : undefined);
        if (
          !selection ||
          selection.documentText?.trim() !== currentDocumentText
        ) {
          return null;
        }
        return refineSelection({
          ...selection,
          instruction: retryInstruction,
        });
      }
      return refine({
        entryId: current.entryId,
        instruction: retryInstruction,
        mode: current.mode === 'overhaul' ? 'overhaul' : 'faithful',
        sourceText: currentDocumentText,
      });
    },
    [publishProposal, refine, refineSelection],
  );

  const dismissProposal = useCallback(() => {
    const current = proposalRef.current;
    archiveProposal(current);
    publishProposal(null);
  }, [archiveProposal, publishProposal]);

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
  const variantErrors = isCurrentActivation(variantSet) ? variantSet!.errors : [];
  const isRefining = isCurrentActivation(refinementRequest);
  const isGeneratingVariants = isCurrentActivation(variantRequest);
  const currentProposal =
    isCurrentActivation(proposal) ? proposal : null;
  const currentAttempts = attempts.filter(isCurrentActivation);
  const streamingText = currentProposal?.text ?? '';

  return {
    isRefining,
    refine,
    refineSelection,
    variants,
    variantErrors,
    isGeneratingVariants,
    generateVariants,
    acceptVariant,
    acceptProposal,
    attempts: currentAttempts,
    dismissProposal,
    proposal: currentProposal,
    rejectProposal,
    retryProposal,
    streamingText,
    cancel,
  };
}

export type RefinementController = ReturnType<typeof useRefinement>;
