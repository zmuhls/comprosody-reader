import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  activePublication: null as { id: string; title: string } | null,
  activeEntry: null as { id: string; name: string } | null,
}));

function PassThrough({ children }: { children: ReactNode }) {
  return children;
}

vi.mock('radix-ui', () => ({
  Tooltip: {
    Provider: PassThrough,
  },
}));

vi.mock('./context/AppContext', () => ({
  AppProvider: PassThrough,
  useApp: () => ({
    state: {
      activeEntryId: mocks.activeEntry?.id ?? null,
      entries: mocks.activeEntry
        ? { [mocks.activeEntry.id]: mocks.activeEntry }
        : {},
    },
  }),
}));

vi.mock('./context/RecordingContext', () => ({
  RecordingProvider: PassThrough,
}));

vi.mock('./context/LibraryContext', () => ({
  LibraryProvider: PassThrough,
  useLibrary: () => ({
    activePublication: mocks.activePublication,
  }),
}));

vi.mock('./context/SpeechContext', () => ({
  SpeechProvider: PassThrough,
}));

vi.mock('./components/layout/Sidebar', () => ({
  Sidebar: ({
    isOpen,
    onClose,
  }: {
    isOpen: boolean;
    onClose: () => void;
  }) => (
    <aside data-open={String(isOpen)}>
      Directory
      <button onClick={onClose} type="button">
        Close directory
      </button>
    </aside>
  ),
}));

vi.mock('./components/layout/MainPanel', () => ({
  MainPanel: () => (
    <main>
      <label>
        Draft
        <input aria-label="Draft" defaultValue="" />
      </label>
    </main>
  ),
}));

vi.mock('./components/layout/ErrorBanner', () => ({
  ErrorBanner: () => null,
}));

vi.mock('./components/layout/ScholarRail', () => ({
  ScholarRail: () => null,
}));

vi.mock('./components/layout/CommandPalette', () => ({
  CommandPalette: () => null,
}));

vi.mock('./components/library/ReadingPane', () => ({
  ReadingPane: () => <section>Reader canvas</section>,
}));

import App from './App';

describe('mobile reading workspace', () => {
  beforeEach(() => {
    mocks.activePublication = null;
    mocks.activeEntry = null;
    document.title = 'Comprosody';
  });

  it('keeps the browser title aligned with the active note or reading view', async () => {
    mocks.activeEntry = { id: 'note-1', name: 'Field recording' };
    const { rerender } = render(<App />);
    await waitFor(() => expect(document.title).toBe('Field recording — Comprosody'));

    mocks.activePublication = { id: 'book-1', title: 'Book one' };
    rerender(<App />);
    await waitFor(() => expect(document.title).toBe('Book one — Comprosody'));

    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    await waitFor(() => expect(document.title).toBe('Field recording — Comprosody'));
  });

  it('keeps the note mounted and exposes an accessible Reader/Note switch', () => {
    const { rerender } = render(<App />);
    const draft = screen.getByRole('textbox', { name: 'Draft' });
    fireEvent.change(draft, { target: { value: 'A thought in progress' } });

    mocks.activePublication = { id: 'book-1', title: 'Book one' };
    rerender(<App />);

    const switcher = screen.getByRole('navigation', {
      name: 'Reading workspace view',
    });
    const readerButton = screen.getByRole('button', { name: 'Reader' });
    const noteButton = screen.getByRole('button', { name: 'Note' });
    const workspace = switcher.parentElement;

    expect(readerButton.getAttribute('aria-pressed')).toBe('true');
    expect(noteButton.getAttribute('aria-pressed')).toBe('false');
    expect(workspace?.classList.contains('mobile-view-reader')).toBe(true);
    expect((draft as HTMLInputElement).value).toBe('A thought in progress');

    fireEvent.click(noteButton);

    expect(readerButton.getAttribute('aria-pressed')).toBe('false');
    expect(noteButton.getAttribute('aria-pressed')).toBe('true');
    expect(workspace?.classList.contains('mobile-view-note')).toBe(true);
    expect(screen.queryByText('Reader canvas')).not.toBeNull();
    expect((draft as HTMLInputElement).value).toBe('A thought in progress');
  });

  it('returns to the reader when a different publication opens', async () => {
    mocks.activePublication = { id: 'book-1', title: 'Book one' };
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));

    mocks.activePublication = { id: 'book-2', title: 'Book two' };
    rerender(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Reader' }).getAttribute(
          'aria-pressed',
        ),
      ).toBe('true');
    });
  });

  it('opens the note directory from the mobile reading switch', () => {
    mocks.activePublication = { id: 'book-1', title: 'Book one' };
    render(<App />);

    const directory = screen.getByText('Directory').closest('aside');
    expect(directory?.getAttribute('data-open')).toBe('false');

    fireEvent.click(
      screen.getByRole('button', { name: 'Open note directory' }),
    );

    expect(directory?.getAttribute('data-open')).toBe('true');
  });
});
