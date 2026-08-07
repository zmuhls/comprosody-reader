import { fireEvent, render, screen } from '@testing-library/react';
import type { Entry } from '../../types/editor';
import { defaultProsody, defaultVoiceConfig } from '../../types/audio';
import { DocumentTitle, SourceTranscriptDrawer } from './Editor';

function makeEntry(name: string): Entry {
  return {
    id: 'entry-1',
    name,
    parentId: null,
    kind: 'note',
    order: 0,
    rawTranscript: '',
    refinedText: '',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('DocumentTitle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('protects an in-progress manual draft from a delayed automatic title', () => {
    const onCommit = vi.fn();
    const onEnterBody = vi.fn();
    const { rerender } = render(
      <DocumentTitle
        entry={makeEntry('Original')}
        onCommit={onCommit}
        onEnterBody={onEnterBody}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Rename note title: Original' }),
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

    expect((title as HTMLInputElement).value).toBe('Uncommitted draft');
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Uncommitted draft');
  });

  it('accepts a synthesized assistive click', () => {
    render(
      <DocumentTitle
        entry={makeEntry('Original')}
        onCommit={vi.fn()}
        onEnterBody={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Rename note title: Original' }),
      { detail: 0 },
    );
    expect(screen.getByRole('textbox', { name: 'Note title' })).not.toBeNull();
  });

  it('renames on a single activation and enters the note body after Enter', () => {
    const onCommit = vi.fn();
    const onEnterBody = vi.fn();
    render(
      <DocumentTitle
        entry={makeEntry('Original')}
        onCommit={onCommit}
        onEnterBody={onEnterBody}
      />,
    );

    // One click, not two: the double-click/double-tap gesture is gone.
    fireEvent.click(
      screen.getByRole('button', { name: 'Rename note title: Original' }),
    );
    const input = screen.getByRole('textbox', { name: 'Note title' });
    fireEvent.change(input, { target: { value: 'Chosen note title' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith('Chosen note title');
    expect(onEnterBody).toHaveBeenCalledOnce();
  });

  it('renames from the keyboard without a pointer', () => {
    render(
      <DocumentTitle
        entry={makeEntry('Original')}
        onCommit={vi.fn()}
        onEnterBody={vi.fn()}
      />,
    );
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Rename note title: Original' }),
      { key: 'F2' },
    );
    expect(screen.getByRole('textbox', { name: 'Note title' })).not.toBeNull();
  });
});

describe('SourceTranscriptDrawer', () => {
  it('does not leave closed transcript content in the accessibility or tab tree', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SourceTranscriptDrawer
        entryId="entry-1"
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
        entryId="entry-1"
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

describe('SourceTranscriptDrawer editing', () => {
  it('lets the writer correct the stored speech record', () => {
    const onChangeTranscript = vi.fn();
    render(
      <SourceTranscriptDrawer
        entryId="entry-1"
        interimTranscript=""
        isOpen
        onChangeTranscript={onChangeTranscript}
        onClose={vi.fn()}
        rawTranscript="the seal was marc"
      />,
    );

    const field = screen.getByRole('textbox', { name: 'Source transcript' });
    expect((field as HTMLTextAreaElement).value).toBe('the seal was marc');
    fireEvent.change(field, { target: { value: 'the seal was Mark' } });
    expect(onChangeTranscript).toHaveBeenCalledWith('the seal was Mark');
  });

  it('locks the field while recording so interim text is never typed over', () => {
    render(
      <SourceTranscriptDrawer
        entryId="entry-1"
        interimTranscript="and then"
        isOpen
        isRecording
        onChangeTranscript={vi.fn()}
        onClose={vi.fn()}
        rawTranscript="first take"
      />,
    );

    const field = screen.getByRole('textbox', {
      name: 'Source transcript',
    }) as HTMLTextAreaElement;
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe('first take and then');
  });

  it('surfaces correction candidates beside the transcript', () => {
    const onConfirmCandidate = vi.fn();
    render(
      <SourceTranscriptDrawer
        candidates={[
          {
            id: 'marc→Mark',
            heard: 'marc',
            canonical: 'Mark',
            similarity: 0.9,
          },
        ]}
        entryId="entry-1"
        interimTranscript=""
        isOpen
        onChangeTranscript={vi.fn()}
        onClose={vi.fn()}
        onConfirmCandidate={onConfirmCandidate}
        onDismissCandidate={vi.fn()}
        rawTranscript="the seal was Mark"
      />,
    );

    expect(screen.queryByText(/marc/i)).not.toBeNull();
  });
});
