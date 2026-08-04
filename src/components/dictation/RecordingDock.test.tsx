import { fireEvent, render, waitFor } from '@testing-library/react';
import { defaultProsody } from '../../types/audio';
import { RecordingDock } from './RecordingDock';

vi.mock('./ProsodyPanel', () => ({ ProsodyPanel: () => null }));
vi.mock('./RecordButton', () => ({ RecordButton: () => null }));
vi.mock('./VoiceConfigToggles', () => ({ VoiceConfigToggles: () => null }));
vi.mock('./Waveform', () => ({ Waveform: () => null }));

const baseProps = {
  backgroundLimitMs: 120_000,
  backgroundNotice: '',
  drawWaveform: vi.fn(),
  isRecording: false,
  isTranscribing: false,
  onBackgroundLimitChange: vi.fn(),
  onProviderChange: vi.fn(),
  onStart: vi.fn(),
  onStop: vi.fn(),
  prosody: defaultProsody,
  provider: 'local' as const,
};

describe('RecordingDock', () => {
  it('disables provider changes for the entire recording and transcription window', () => {
    const view = render(<RecordingDock {...baseProps} isRecording />);

    expect(
      view.getByRole('combobox', { name: 'Transcription provider' }).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
    expect(
      view.getByRole('combobox', { name: 'Background recording limit' }).hasAttribute(
        'disabled',
      ),
    ).toBe(true);

    view.rerender(
      <RecordingDock {...baseProps} isRecording={false} isTranscribing />,
    );
    expect(
      view.getByRole('combobox', { name: 'Transcription provider' }).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
  });

  it('announces recording lifecycle changes as one polite atomic status', () => {
    const view = render(
      <RecordingDock {...baseProps} backgroundNotice="Recording while away" isRecording />,
    );
    const status = view.getByRole('status');
    expect(status.textContent).toBe('Recording while away');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-atomic')).toBe('true');
  });

  it('describes the iOS background-recording limit without relying on hover text', () => {
    const view = render(<RecordingDock {...baseProps} />);
    const trigger = view.getByRole('combobox', {
      name: 'Background recording limit',
    });
    const descriptionId = trigger.getAttribute('aria-describedby');

    expect(descriptionId).toBe('background-recording-help');
    expect(document.getElementById(descriptionId!)?.textContent).toContain(
      'iOS may pause the page sooner',
    );
  });

  it('opens recording options before recording and returns focus when they close', async () => {
    const view = render(<RecordingDock {...baseProps} />);
    const trigger = view.getByRole('button', { name: 'Recording options' });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const provider = view.getByRole('combobox', { name: 'Transcription provider' });
    const backgroundLimit = view.getByRole('combobox', {
      name: 'Background recording limit',
    });
    expect(provider.hasAttribute('disabled')).toBe(false);
    expect(backgroundLimit.hasAttribute('disabled')).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(provider));

    fireEvent.click(view.getByRole('button', { name: 'Close recording options' }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
