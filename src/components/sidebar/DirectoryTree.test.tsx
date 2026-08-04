import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultProsody, defaultVoiceConfig } from '../../types/audio';
import type { Directory, Entry } from '../../types/editor';

const mocks = vi.hoisted(() => ({
  deleteDirectory: vi.fn(),
  deleteEntry: vi.fn(),
  moveDirectory: vi.fn(),
  moveEntry: vi.fn(),
  renameDirectory: vi.fn(),
  renameEntry: vi.fn(),
  setActiveEntry: vi.fn(),
  setTitleEditingEntryId: vi.fn(),
}));

const directories: Record<string, Directory> = {
  archive: { id: 'archive', name: 'Archive', parentId: null, kind: 'folder' },
};
const entries: Record<string, Entry> = {
  note: {
    id: 'note',
    name: 'Research note',
    parentId: null,
    kind: 'note',
    order: 0,
    rawTranscript: '',
    refinedText: '',
    prosody: { ...defaultProsody },
    voiceConfig: { ...defaultVoiceConfig },
    createdAt: 1,
    updatedAt: 1,
  },
};

vi.mock('../../hooks/useStorage', () => ({
  useStorage: () => ({
    activeEntryId: null,
    directories,
    entries,
    ...mocks,
  }),
}));

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({
    setTitleEditingEntryId: mocks.setTitleEditingEntryId,
  }),
}));

import { DirectoryTree } from './DirectoryTree';

function touchPointerUp(element: Element): void {
  const event = new Event('pointerup', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  fireEvent(element, event);
}

describe('DirectoryTree organization controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets touch and keyboard users pick a note and place it in a folder', () => {
    render(<DirectoryTree />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Research note' }));
    expect(screen.getByRole('status').textContent).toBe(
      'Moving Research note. Choose a destination.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'place here' }));

    expect(mocks.moveEntry).toHaveBeenCalledWith('note', 'archive');
    expect(screen.getByRole('status').textContent).toBe(
      'Research note moved to Archive.',
    );
    expect(screen.getByRole('status').getAttribute('aria-atomic')).toBe('true');
  });

  it('announces cancellation when a picked move is cancelled', () => {
    render(<DirectoryTree />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Research note' }));
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));

    expect(screen.getByRole('status').textContent).toBe(
      'Move cancelled for Research note.',
    );
  });

  it('announces cancellation when a desktop drag ends without a destination', () => {
    render(<DirectoryTree />);
    const row = screen.getByRole('button', { name: 'Research note' }).closest('.tree-row');
    const dataTransfer = { effectAllowed: 'none', setData: vi.fn() };
    fireEvent.dragStart(row!, { dataTransfer });
    expect(screen.getByRole('status').textContent).toBe(
      'Moving Research note. Drop it on a destination.',
    );

    fireEvent.dragEnd(row!);
    expect(screen.getByRole('status').textContent).toBe(
      'Move cancelled for Research note.',
    );
  });

  it('renames on double-click and restores focus after an explicit commit', async () => {
    render(<DirectoryTree />);
    const primary = screen.getByRole('button', { name: 'Research note' });
    fireEvent.doubleClick(primary);
    const input = screen.getByRole('textbox', { name: 'Rename entry' });
    fireEvent.change(input, { target: { value: 'Archive argument' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mocks.renameEntry).toHaveBeenCalledWith('note', 'Archive argument');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', {
      name: 'Research note',
    })));
  });

  it('renames on a deliberate double tap before closing the mobile directory', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_240);
    render(<DirectoryTree />);
    const primary = screen.getByRole('button', { name: 'Research note' });

    touchPointerUp(primary);
    touchPointerUp(primary);

    expect(screen.getByRole('textbox', { name: 'Rename entry' })).not.toBeNull();
    expect(mocks.setActiveEntry).not.toHaveBeenCalled();
  });

  it('offers an explicit accessible rename action and restores focus after cancel', async () => {
    render(<DirectoryTree />);
    fireEvent.click(screen.getByRole('button', {
      name: 'Rename entry Research note',
    }));
    const input = screen.getByRole('textbox', { name: 'Rename entry' });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(mocks.renameEntry).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', {
      name: 'Research note',
    })));
  });
});
