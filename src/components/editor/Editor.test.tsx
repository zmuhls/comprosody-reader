import { fireEvent, render, screen } from '@testing-library/react';
import type { Entry } from '../../types/editor';
import { defaultProsody, defaultVoiceConfig } from '../../types/audio';
import { DocumentTitle, SourceTranscriptDrawer } from './Editor';

function makeEntry(name: string): Entry {
  return {
    id: 'entry-1',
    name,
    parentId: null,
    rawTranscript: '',
    refinedText: '',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('DocumentTitle', () => {
  it('synchronizes an external rename even when a local draft exists', () => {
    const onCommit = vi.fn();
    const onEnterBody = vi.fn();
    const { rerender } = render(
      <DocumentTitle
        entry={makeEntry('Original')}
        onCommit={onCommit}
        onEnterBody={onEnterBody}
      />,
    );
    const title = screen.getByRole('textbox', { name: 'Note title' });
    fireEvent.change(title, { target: { value: 'Uncommitted draft' } });
    expect((title as HTMLInputElement).value).toBe('Uncommitted draft');

    rerender(
      <DocumentTitle
        entry={makeEntry('Renamed elsewhere')}
        onCommit={onCommit}
        onEnterBody={onEnterBody}
      />,
    );

    expect((title as HTMLInputElement).value).toBe('Renamed elsewhere');
  });
});

describe('SourceTranscriptDrawer', () => {
  it('does not leave closed transcript content in the accessibility or tab tree', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SourceTranscriptDrawer
        interimTranscript=""
        isOpen={false}
        onClose={onClose}
        rawTranscript="Private source text"
      />,
    );

    expect(screen.queryByRole('complementary', { name: 'Source transcript' })).toBeNull();
    expect(screen.queryByText('Private source text')).toBeNull();

    rerender(
      <SourceTranscriptDrawer
        interimTranscript="continuing"
        isOpen
        onClose={onClose}
        rawTranscript="Private source text"
      />,
    );
    expect(
      screen.getByRole('complementary', { name: 'Source transcript' }).textContent,
    ).toContain('Private source text continuing');

    fireEvent.click(screen.getByRole('button', { name: 'Close source transcript' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
