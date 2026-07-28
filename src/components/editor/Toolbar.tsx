import { memo, useState, type FormEvent } from 'react';
import { Icon } from '../ui/Icon';

interface Props {
  hasSelection: boolean;
  isRefining: boolean;
  onCancel: () => void;
  onFaithfulEdit: () => void;
  onFullOverhaul: () => void;
  onInstruction: (instruction: string) => Promise<boolean>;
}

export const RefinementComposer = memo(function RefinementComposer({
  hasSelection,
  isRefining,
  onCancel,
  onFaithfulEdit,
  onFullOverhaul,
  onInstruction,
}: Props) {
  const [instruction, setInstruction] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = instruction.trim();
    if (!value || isRefining) return;
    const applied = await onInstruction(value);
    if (applied) setInstruction('');
  };

  return (
    <div className="refinement-composer">
      <form className="refinement-input-shell" onSubmit={submit}>
        <input
          aria-label={hasSelection ? 'Refine selected text' : 'Refine this note'}
          disabled={isRefining}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={
            hasSelection ? 'Refine the selection…' : 'Refine this passage…'
          }
          value={instruction}
        />
        <button
          aria-label="Apply focused refinement"
          className="refinement-send"
          disabled={!instruction.trim() || isRefining}
          type="submit"
        >
          <Icon name="arrow-up" size={15} />
        </button>
      </form>

      <div className="refinement-actions">
        {isRefining ? (
          <button className="text-action is-active" onClick={onCancel} type="button">
            Stop proposal
          </button>
        ) : (
          <button className="text-action is-active" onClick={onFaithfulEdit} type="button">
            Faithful edit
          </button>
        )}

        <button
          className="text-action"
          disabled={isRefining}
          onClick={onFullOverhaul}
          type="button"
        >
          Full overhaul
        </button>
      </div>
    </div>
  );
});
