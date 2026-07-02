import { useState, useRef, useCallback, memo } from 'react';
import { useApp } from '../../context/AppContext';
import { useRefinement } from '../../hooks/useRefinement';
import { TranscriptView } from './TranscriptView';
import { Toolbar } from './Toolbar';
import { VariantCards } from './VariantCards';

interface Props {
  interimTranscript: string;
  isRecording: boolean;
}

export const Editor = memo(function Editor({ interimTranscript, isRecording }: Props) {
  const { state, dispatch } = useApp();
  const { refineSelection, variants, acceptVariant, isRefining, isGeneratingVariants,
          refine, generateVariants, streamingText } = useRefinement();
  const refinedRef = useRef<HTMLTextAreaElement>(null);
  const [hasSelection, setHasSelection] = useState(false);

  const activeEntry = state.activeEntryId
    ? state.entries[state.activeEntryId]
    : null;

  const handleRefineSelection = useCallback(() => {
    const textarea = refinedRef.current;
    if (!textarea) return;
    const { selectionStart, selectionEnd } = textarea;
    if (selectionStart === selectionEnd) return;
    refineSelection(selectionStart, selectionEnd);
  }, [refineSelection]);

  const handleSelectionChange = useCallback(() => {
    const textarea = refinedRef.current;
    if (!textarea) return;
    setHasSelection(textarea.selectionStart !== textarea.selectionEnd);
  }, []);

  const updateRefinedText = useCallback(
    (value: string) => {
      if (!activeEntry) return;
      dispatch({
        type: 'UPDATE_ENTRY',
        id: activeEntry.id,
        updates: { refinedText: value },
        recordHistory: false,
      });
    },
    [activeEntry, dispatch]
  );

  if (!activeEntry) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-xs">
        Select or create an entry to begin.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Toolbar
        onRefineSelection={handleRefineSelection}
        hasSelection={hasSelection}
        isRefining={isRefining}
        isGeneratingVariants={isGeneratingVariants}
        onRefine={refine}
        onGenerateVariants={generateVariants}
      />

      <div className="flex-1 flex min-h-0">
        <TranscriptView
          rawTranscript={activeEntry.rawTranscript}
          interimTranscript={interimTranscript}
          isRecording={isRecording}
        />

        <div className="w-px bg-border" />

        <div className="flex-1 flex flex-col min-w-0">
          <div className="text-[10px] text-text-muted px-3 py-1.5 border-b border-border uppercase tracking-wider">
            refined
          </div>
          <textarea
            ref={refinedRef}
            value={isRefining && streamingText ? streamingText : activeEntry.refinedText}
            onChange={(e) => updateRefinedText(e.target.value)}
            onSelect={handleSelectionChange}
            onMouseUp={handleSelectionChange}
            onKeyUp={handleSelectionChange}
            placeholder="Refined text will appear here after running refinement."
            className="flex-1 w-full resize-none bg-transparent text-text-primary text-xs p-3 outline-none placeholder:text-text-muted"
          />
        </div>
      </div>

      <VariantCards variants={variants} onAccept={acceptVariant} />
    </div>
  );
});
