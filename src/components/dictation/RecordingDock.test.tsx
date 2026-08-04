import { render } from '@testing-library/react';
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
});
