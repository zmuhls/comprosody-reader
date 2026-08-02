import { fireEvent, render, screen } from '@testing-library/react';
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
}));

const directories: Record<string, Directory> = {
  archive: { id: 'archive', name: 'Archive', parentId: null },
};
const entries: Record<string, Entry> = {
  note: {
    id: 'note',
    name: 'Research note',
    parentId: null,
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
    fireEvent.click(screen.getByRole('button', { name: 'place here' }));

    expect(mocks.moveEntry).toHaveBeenCalledWith('note', 'archive');
    expect(screen.getByRole('status').textContent).toBe(
      'Research note moved to Archive.',
    );
  });

  it('renames on double-click without opening a permanent inline field', () => {
    render(<DirectoryTree />);
    const row = screen.getByText('Research note').closest('[role="treeitem"]');
    expect(row).not.toBeNull();
    fireEvent.doubleClick(row!);
    const input = screen.getByRole('textbox', { name: 'Rename entry' });
    fireEvent.change(input, { target: { value: 'Archive argument' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mocks.renameEntry).toHaveBeenCalledWith('note', 'Archive argument');
  });

  it('renames on a deliberate double tap before closing the mobile directory', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_240);
    render(<DirectoryTree />);
    const row = screen.getByText('Research note').closest('[role="treeitem"]');
    expect(row).not.toBeNull();

    touchPointerUp(row!);
    touchPointerUp(row!);

    expect(screen.getByRole('textbox', { name: 'Rename entry' })).not.toBeNull();
    expect(mocks.setActiveEntry).not.toHaveBeenCalled();
  });
});
