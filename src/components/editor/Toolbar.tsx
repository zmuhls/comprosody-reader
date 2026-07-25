import { memo, useState, type FormEvent } from 'react';
import { Switch, Tooltip } from 'radix-ui';
import { useApp } from '../../context/AppContext';
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
  const { state, dispatch } = useApp();
  const [instruction, setInstruction] = useState('');
  const { refinementSettings } = state;

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
            Stop refinement
          </button>
        ) : (
          <button className="text-action is-active" onClick={onFaithfulEdit} type="button">
            Faithful edit
          </button>
        )}

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              aria-pressed={refinementSettings.highFidelity !== false}
              className="text-action"
              onClick={() =>
                dispatch({
                  type: 'UPDATE_REFINEMENT_SETTINGS',
                  settings: {
                    highFidelity: refinementSettings.highFidelity === false,
                  },
                })
              }
              type="button"
            >
              {refinementSettings.highFidelity === false
                ? 'Lighter touch'
                : 'High fidelity'}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content className="ui-tooltip" sideOffset={7}>
              Preserve wording, uncertainty, and disciplinary vocabulary.
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        <button
          className="text-action"
          disabled={isRefining}
          onClick={onFullOverhaul}
          type="button"
        >
          Full overhaul
        </button>

        <label className="auto-refine-control">
          <span>Auto-refine</span>
          <Switch.Root
            aria-label="Automatically run a faithful edit after transcription"
            checked={refinementSettings.autoRefine !== false}
            className="mini-switch"
            onCheckedChange={(checked) =>
              dispatch({
                type: 'UPDATE_REFINEMENT_SETTINGS',
                settings: { autoRefine: checked },
              })
            }
          >
            <Switch.Thumb className="mini-switch-thumb" />
          </Switch.Root>
        </label>
      </div>
    </div>
  );
});
