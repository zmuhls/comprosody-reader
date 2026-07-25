import { render } from '@testing-library/react';
import { defaultProsody } from '../../types/audio';
import { RecordingDock } from './RecordingDock';

vi.mock('./ProsodyPanel', () => ({ ProsodyPanel: () => null }));
vi.mock('./RecordButton', () => ({ RecordButton: () => null }));
vi.mock('./VoiceConfigToggles', () => ({ VoiceConfigToggles: () => null }));
vi.mock('./Waveform', () => ({ Waveform: () => null }));

const baseProps = {
  drawWaveform: vi.fn(),
  isRecording: false,
  isTranscribing: false,
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

    view.rerender(
      <RecordingDock {...baseProps} isRecording={false} isTranscribing />,
    );
    expect(
      view.getByRole('combobox', { name: 'Transcription provider' }).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
  });
});
