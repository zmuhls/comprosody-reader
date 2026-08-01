import { useApp } from '../../context/AppContext';
import { SettingsRail } from './SettingsRail';

interface Props {
  onRefine: () => void;
  onRefineSelection: () => void;
  onGenerateVariants: () => void;
  onSeedDraft: () => void;
  onUndo: () => void;
  onCopy: () => void;
  onExport: () => void;
  canUndo: boolean;
  copied: boolean;
  hasSelection: boolean;
  hasTranscript: boolean;
  hasRefinedText: boolean;
  isRefining: boolean;
  isGeneratingVariants: boolean;
}

const SECONDARY_BUTTON =
  'px-2 py-1.5 text-[10px] uppercase tracking-[0.18em] text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35';

function Delimiter() {
  return (
    <span className="select-none text-text-muted/40" aria-hidden="true">
      ·
    </span>
  );
}

export function Toolbar({
  onRefine,
  onRefineSelection,
  onGenerateVariants,
  onSeedDraft,
  onUndo,
  onCopy,
  onExport,
  canUndo,
  copied,
  hasSelection,
  hasTranscript,
  hasRefinedText,
  isRefining,
  isGeneratingVariants,
}: Props) {
  const { state } = useApp();
  const hasEntry = !!state.activeEntryId;
  const canRefine =
    hasEntry && hasTranscript && !isRefining && !isGeneratingVariants;
  const hasContent = hasTranscript || hasRefinedText;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2 sm:px-5">
      <SettingsRail />

      <div className="flex-1" />

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={onSeedDraft}
          disabled={!hasTranscript || isRefining || isGeneratingVariants}
          className={SECONDARY_BUTTON}
        >
          {hasRefinedText ? 'reset draft' : 'seed draft'}
        </button>

        <Delimiter />

        <button
          onClick={onUndo}
          disabled={!canUndo || isRefining || isGeneratingVariants}
          className={SECONDARY_BUTTON}
        >
          undo
        </button>

        <Delimiter />

        <button
          onClick={onRefine}
          disabled={!canRefine}
          className="border border-accent bg-accent px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-canvas transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-35"
        >
          {isRefining ? 'refining…' : 'refine'}
        </button>

        <button
          onClick={onRefineSelection}
          disabled={!canRefine || !hasSelection}
          className={SECONDARY_BUTTON}
        >
          selection
        </button>

        <button
          onClick={onGenerateVariants}
          disabled={!canRefine}
          className={SECONDARY_BUTTON}
        >
          {isGeneratingVariants ? 'generating…' : 'passes'}
        </button>

        <Delimiter />

        <button
          onClick={onCopy}
          disabled={!hasContent}
          className={`${SECONDARY_BUTTON} ${copied ? 'text-success hover:text-success' : ''}`}
        >
          {copied ? 'copied' : 'copy'}
        </button>

        <button
          onClick={onExport}
          disabled={!hasContent}
          className={SECONDARY_BUTTON}
        >
          export
        </button>
      </div>
    </div>
  );
}
