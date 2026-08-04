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

function touchPointerUp(element: Element): void {
  const event = new Event('pointerup', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  fireEvent(element, event);
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
    fireEvent.doubleClick(
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

  it('accepts a synthesized assistive click without changing pointer shortcuts', () => {
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

  it('renames on double tap and enters the note body after Enter', () => {
    const onCommit = vi.fn();
    const onEnterBody = vi.fn();
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_220);
    render(
      <DocumentTitle
        entry={makeEntry('Original')}
        onCommit={onCommit}
        onEnterBody={onEnterBody}
      />,
    );
    const display = screen.getByRole('button', {
      name: 'Rename note title: Original',
    });

    touchPointerUp(display);
    touchPointerUp(display);
    const input = screen.getByRole('textbox', { name: 'Note title' });
    fireEvent.change(input, { target: { value: 'Chosen note title' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith('Chosen note title');
    expect(onEnterBody).toHaveBeenCalledOnce();
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
