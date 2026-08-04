import { useState, type FormEvent } from 'react';
import { Dialog, Switch } from 'radix-ui';
import { useApp } from '../../context/AppContext';
import type {
  RefinementController,
  RefinementProposal,
} from '../../hooks/useRefinement';
import { Icon } from '../ui/Icon';

interface Props {
  hasSelection: boolean;
  isOpen: boolean;
  onAccept: () => boolean;
  onFaithfulEdit: () => void;
  onFullOverhaul: () => void;
  onInstruction: (instruction: string) => Promise<boolean>;
  onRetry: (guidance: string) => Promise<boolean>;
  refinement: RefinementController;
}

function proposalLabel(mode: RefinementProposal['mode']): string {
  if (mode === 'overhaul') return 'Full overhaul';
  if (mode === 'selection') return 'Focused selection';
  if (mode === 'variants') return 'Generated variant';
  return 'Faithful edit';
}

export function RefinementSidecar({
  hasSelection,
  isOpen,
  onAccept,
  onFaithfulEdit,
  onFullOverhaul,
  onInstruction,
  onRetry,
  refinement,
}: Props) {
  const { state, dispatch } = useApp();
  const [guidance, setGuidance] = useState('');
  const proposal = refinement.proposal;

  if (!isOpen) return null;

  const submitGuidance = async (event: FormEvent) => {
    event.preventDefault();
    const value = guidance.trim();
    if (!value || refinement.isRefining) return;

    const succeeded = proposal
      ? await onRetry(value)
      : await onInstruction(value);
    if (succeeded) setGuidance('');
  };

  const statusText = proposal
    ? proposal.status === 'streaming'
      ? 'Writing a proposal…'
      : proposal.status === 'ready'
        ? 'Ready for your decision'
        : proposal.status === 'rejected'
          ? 'Rejected — guide a retry if useful'
          : proposal.status === 'stale'
            ? 'The source changed — retry against the current note'
            : proposal.error ?? 'This attempt did not complete'
    : 'Choose a preset or tell the editor what to attend to.';

  return (
    <Dialog.Portal>
      <Dialog.Content asChild>
        <section className="refinement-sidecar is-open">
      <div className="refinement-sidecar-header">
        <div>
          <Dialog.Title asChild>
            <strong>Refinement</strong>
          </Dialog.Title>
          <Dialog.Description asChild>
            <span>Nothing changes until you accept.</span>
          </Dialog.Description>
        </div>
        <Dialog.Close asChild>
          <button
            aria-label="Close refinement"
            className="icon-button"
            type="button"
          >
            <Icon name="x" size={15} />
          </button>
        </Dialog.Close>
      </div>

      <div className="refinement-sidecar-scroll">
        <section className="refinement-presets" aria-label="Refinement presets">
          <button
            className="refinement-preset"
            disabled={refinement.isRefining}
            onClick={onFaithfulEdit}
            type="button"
          >
            <strong>Faithful edit</strong>
            <span>Copy edit and connect; preserve claims and voice.</span>
          </button>
          <button
            className="refinement-preset"
            disabled={refinement.isRefining}
            onClick={onFullOverhaul}
            type="button"
          >
            <strong>Full overhaul</strong>
            <span>Thread the recurring idea through rambling material.</span>
          </button>
        </section>

        <details className="refinement-settings">
          <summary>Settings</summary>
          <label>
            <span>
              <strong>High fidelity</strong>
              <small>Keep uncertainty, vocabulary, and phrasing.</small>
            </span>
            <Switch.Root
              aria-label="Use high-fidelity refinement"
              checked={state.refinementSettings.highFidelity !== false}
              className="mini-switch"
              disabled={refinement.isRefining}
              onCheckedChange={(checked) =>
                dispatch({
                  type: 'UPDATE_REFINEMENT_SETTINGS',
                  settings: { highFidelity: checked },
                })
              }
            >
              <Switch.Thumb className="mini-switch-thumb" />
            </Switch.Root>
          </label>
          <label>
            <span>
              <strong>Propose after transcription</strong>
              <small>Generate a reviewable draft; never auto-apply it.</small>
            </span>
            <Switch.Root
              aria-label="Propose a faithful edit after transcription"
              checked={state.refinementSettings.autoRefine !== false}
              className="mini-switch"
              disabled={refinement.isRefining}
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
          <p>Model: configured Ollama Cloud refinement service</p>
        </details>

        {refinement.attempts.length > 0 ? (
          <section className="refinement-attempts" aria-label="Earlier attempts">
            <h2>Earlier attempts</h2>
            {refinement.attempts.slice(-3).map((attempt) => (
              <details key={attempt.id}>
                <summary>
                  {proposalLabel(attempt.mode)} · {attempt.status}
                </summary>
                {attempt.instruction ? (
                  <p className="refinement-attempt-guidance">
                    {attempt.instruction}
                  </p>
                ) : null}
                <div>{attempt.text || 'No candidate text was returned.'}</div>
              </details>
            ))}
          </section>
        ) : null}

        <section className="refinement-candidate">
          <div className="refinement-candidate-heading">
            <strong>
              {proposal ? proposalLabel(proposal.mode) : 'Model proposal'}
            </strong>
            <span
              aria-live="polite"
              data-status={proposal?.status ?? 'idle'}
              role="status"
            >
              {statusText}
            </span>
          </div>
          <div className="refinement-candidate-copy">
            {proposal?.text ||
              'The proposed revision will stream here while your note remains untouched.'}
            {proposal?.status === 'streaming' ? (
              <span className="refinement-stream-caret" aria-hidden="true" />
            ) : null}
          </div>
          {proposal?.error ? (
            <p className="refinement-candidate-error" role="alert">
              {proposal.error}
            </p>
          ) : null}
        </section>
      </div>

      <footer className="refinement-sidecar-footer">
        {proposal?.status === 'ready' ? (
          <div className="refinement-decision-row">
            <button
              className="refinement-accept"
              onClick={onAccept}
              type="button"
            >
              Accept
            </button>
            <button
              className="refinement-reject"
              onClick={refinement.rejectProposal}
              type="button"
            >
              Reject
            </button>
          </div>
        ) : proposal?.status === 'streaming' ? (
          <button
            className="refinement-stop"
            onClick={refinement.cancel}
            type="button"
          >
            Stop generation
          </button>
        ) : null}

        <form className="refinement-guidance" onSubmit={submitGuidance}>
          <label htmlFor="refinement-guidance-input">
            {proposal
              ? 'Steer a new attempt'
              : hasSelection
                ? 'Refine the selection'
                : 'Focused guidance'}
          </label>
          <div>
            <input
              disabled={refinement.isRefining}
              id="refinement-guidance-input"
              maxLength={800}
              onChange={(event) => setGuidance(event.target.value)}
              placeholder={
                proposal
                  ? 'Keep the opening; clarify only the last sentence…'
                  : 'Attend to transitions without adding theory…'
              }
              value={guidance}
            />
            <button
              aria-label={proposal ? 'Retry with guidance' : 'Send guidance'}
              disabled={!guidance.trim() || refinement.isRefining}
              type="submit"
            >
              <Icon name={proposal ? 'redo' : 'arrow-up'} size={15} />
            </button>
          </div>
        </form>
      </footer>
        </section>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
