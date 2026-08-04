import { render, screen, fireEvent, act } from '@testing-library/react';
import { AudioTakes } from './AudioTakes';
import type { TakeMeta } from '../../lib/audioStore';

const mocks = vi.hoisted(() => ({
  listTakeMeta: vi.fn(),
  loadTakeBlob: vi.fn(),
}));

vi.mock(import('../../lib/audioStore'), async (importOriginal) => ({
  ...(await importOriginal()),
  listTakeMeta: mocks.listTakeMeta,
  loadTakeBlob: mocks.loadTakeBlob,
}));

const take: TakeMeta = {
  entryId: 'e1',
  recordedAt: 1_700_000_000_000,
  durationMs: 3_000,
  mimeType: 'audio/webm',
  byteSize: 1024,
};

describe('AudioTakes hydration lifecycle', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:fake');
    revokeObjectURL = vi.fn();
    // jsdom ships neither; the component calls both.
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;
    mocks.listTakeMeta.mockResolvedValue([take]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates a take into an object URL on demand', async () => {
    mocks.loadTakeBlob.mockResolvedValue(new Blob(['audio']));
    render(<AudioTakes entryId="e1" />);
    fireEvent.click(await screen.findByText('load audio'));
    await act(async () => {});
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(document.querySelector('audio')).toHaveAttribute('src', 'blob:fake');
  });

  it('never mints an object URL for a row unmounted mid-hydration', async () => {
    let resolveBlob!: (blob: Blob) => void;
    mocks.loadTakeBlob.mockImplementation(
      () => new Promise<Blob>((resolve) => (resolveBlob = resolve))
    );
    const { unmount } = render(<AudioTakes entryId="e1" />);
    fireEvent.click(await screen.findByText('load audio'));

    // Entry switch before the blob arrives unmounts the row.
    unmount();
    await act(async () => {
      resolveBlob(new Blob(['audio']));
    });

    // A URL created after unmount could never be revoked — it must not exist.
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
