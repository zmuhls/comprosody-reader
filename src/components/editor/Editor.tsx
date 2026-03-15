import { useState, useRef, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useRefinement } from '../../hooks/useRefinement';
import { TranscriptView } from './TranscriptView';
import { Toolbar } from './Toolbar';
import { VariantCards } from './VariantCards';

interface Props {
  interimTranscript: string;
  isRecording: boolean;
}

export function Editor({ interimTranscript, isRecording }: Props) {
  const { state, dispatch } = useApp();
  const { refineSelection, variants, acceptVariant } = useRefinement();
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
      />

      <div className="flex-1 flex min-h-0">
        {/* Raw transcript (left) */}
        <TranscriptView
          rawTranscript={activeEntry.rawTranscript}
          interimTranscript={interimTranscript}
          isRecording={isRecording}
        />

        {/* Divider */}
        <div className="w-px bg-border" />

        {/* Refined text (right) */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="text-[10px] text-text-muted px-3 py-1.5 border-b border-border uppercase tracking-wider">
            refined
          </div>
          <textarea
            ref={refinedRef}
            value={activeEntry.refinedText}
            onChange={(e) =>
              dispatch({
                type: 'UPDATE_ENTRY',
                id: activeEntry.id,
                updates: { refinedText: e.target.value },
              })
            }
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
}
