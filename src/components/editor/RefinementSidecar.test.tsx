import { fireEvent, render } from '@testing-library/react';
import { Dialog } from 'radix-ui';
import type {
  RefinementController,
  RefinementProposal,
} from '../../hooks/useRefinement';

const services = vi.hoisted(() => ({
  dispatch: vi.fn(),
  useApp: vi.fn(),
}));

vi.mock('../../context/AppContext', () => ({
  useApp: services.useApp,
}));

import { RefinementSidecar } from './RefinementSidecar';

function proposal(
  status: RefinementProposal['status'],
  text = 'A streamed proposal.',
): RefinementProposal {
  return {
    activation: 0,
    autoTriggered: false,
    entryId: 'entry-a',
    id: 'proposal-a',
    mode: 'faithful',
    sourceText: 'Original note.',
    startedAt: 1,
    startedRevision: {
      rawTranscript: 'Original note.',
      refinedText: 'Original note.',
    },
    status,
    text,
  };
}

function controller(
  current: RefinementProposal | null,
): RefinementController {
  return {
    acceptProposal: vi.fn(),
    acceptVariant: vi.fn(),
    attempts: [],
    cancel: vi.fn(),
    dismissProposal: vi.fn(),
    generateVariants: vi.fn(),
    isGeneratingVariants: false,
    isRefining: current?.status === 'streaming',
    proposal: current,
    refine: vi.fn(),
    refineSelection: vi.fn(),
    rejectProposal: vi.fn(),
    retryProposal: vi.fn().mockResolvedValue('retried'),
    streamingText: current?.text ?? '',
    variants: [],
    variantErrors: [],
  };
}

describe('RefinementSidecar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.useApp.mockReturnValue({
      dispatch: services.dispatch,
      state: {
        refinementSettings: {
          autoRefine: true,
          genre: 'academic',
          highFidelity: true,
          mode: 'faithful',
          scale: 'sentence',
          temperature: 0.2,
        },
      },
    });
  });

  it('renders streamed candidate text before completion and never exposes accept early', () => {
    const streaming = controller(proposal('streaming', 'First streamed clause'));
    const view = render(
      <Dialog.Root open>
        <RefinementSidecar
          hasSelection={false}
          isOpen
          onAccept={vi.fn()}
          onFaithfulEdit={vi.fn()}
          onFullOverhaul={vi.fn()}
          onInstruction={vi.fn()}
          onRetry={vi.fn()}
          refinement={streaming}
        />
      </Dialog.Root>,
    );

    expect(view.getByText('First streamed clause')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Accept' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Stop generation' }));
    expect(streaming.cancel).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit accept or reject decision for a completed proposal', () => {
    const ready = controller(proposal('ready'));
    const onAccept = vi.fn().mockReturnValue(true);
    const view = render(
      <Dialog.Root open>
        <RefinementSidecar
          hasSelection={false}
          isOpen
          onAccept={onAccept}
          onFaithfulEdit={vi.fn()}
          onFullOverhaul={vi.fn()}
          onInstruction={vi.fn()}
          onRetry={vi.fn()}
          refinement={ready}
        />
      </Dialog.Root>,
    );

    fireEvent.click(view.getByRole('button', { name: 'Accept' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole('button', { name: 'Reject' }));
    expect(ready.rejectProposal).toHaveBeenCalledTimes(1);
  });

  it('sends bounded writer guidance into retry while keeping presets separate', async () => {
    const rejected = controller(proposal('rejected'));
    const onRetry = vi.fn().mockResolvedValue(true);
    const view = render(
      <Dialog.Root open>
        <RefinementSidecar
          hasSelection={false}
          isOpen
          onAccept={vi.fn()}
          onFaithfulEdit={vi.fn()}
          onFullOverhaul={vi.fn()}
          onInstruction={vi.fn()}
          onRetry={onRetry}
          refinement={rejected}
        />
      </Dialog.Root>,
    );

    fireEvent.change(view.getByLabelText('Steer a new attempt'), {
      target: { value: 'Keep the cadence; repair only the transition.' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Retry with guidance' }));

    expect(onRetry).toHaveBeenCalledWith(
      'Keep the cadence; repair only the transition.',
    );
  });

  it('keeps writer guidance when a retry fails', async () => {
    const rejected = controller(proposal('rejected'));
    const view = render(
      <Dialog.Root open>
        <RefinementSidecar
          hasSelection={false}
          isOpen
          onAccept={vi.fn()}
          onFaithfulEdit={vi.fn()}
          onFullOverhaul={vi.fn()}
          onInstruction={vi.fn()}
          onRetry={vi.fn().mockResolvedValue(false)}
          refinement={rejected}
        />
      </Dialog.Root>,
    );
    const input = view.getByLabelText('Steer a new attempt');

    fireEvent.change(input, {
      target: { value: 'Retain this guidance after failure.' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Retry with guidance' }));

    expect((input as HTMLInputElement).value).toBe(
      'Retain this guidance after failure.',
    );
  });
});
