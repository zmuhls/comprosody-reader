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
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="font-brand text-xl text-text-muted italic">
            begin here
          </p>
          <p className="text-[11px] text-text-muted mt-1">
            select or create an entry to start dictating
          </p>
        </div>
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
        {/* Raw transcript */}
        <TranscriptView
          rawTranscript={activeEntry.rawTranscript}
          interimTranscript={interimTranscript}
          isRecording={isRecording}
        />

        {/* Divider */}
        <div className="w-px bg-border" />

        {/* Refined text */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="text-[10px] text-text-muted px-4 py-2 border-b border-border uppercase tracking-widest">
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
            className="flex-1 w-full resize-none bg-surface-writing text-text-primary text-base leading-relaxed p-4 outline-none placeholder:text-text-muted/50 font-writing"
          />
        </div>
      </div>

      <VariantCards variants={variants} onAccept={acceptVariant} />
    </div>
  );
}
