import { readBlobWithProgress, TAKES_PAGE_SIZE } from './audioStore';

describe('readBlobWithProgress', () => {
  it('reports monotonic progress up to the full byte size', async () => {
    const bytes = new Uint8Array(1_000_000).fill(7);
    const blob = new Blob([bytes], { type: 'audio/webm' });

    const calls: Array<[number, number]> = [];
    const result = await readBlobWithProgress(blob, (loaded, total) => {
      calls.push([loaded, total]);
    });

    expect(result.size).toBe(blob.size);
    expect(result.type).toBe('audio/webm');
    expect(calls.length).toBeGreaterThan(0);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i][0]).toBeGreaterThanOrEqual(calls[i - 1][0]);
    }
    const last = calls[calls.length - 1];
    expect(last[0]).toBe(blob.size);
    expect(last[1]).toBe(blob.size);
  });

  it('works without a progress callback', async () => {
    const blob = new Blob(['tiny'], { type: 'audio/wav' });
    const result = await readBlobWithProgress(blob);
    expect(result.size).toBe(4);
  });
});

describe('paging constant', () => {
  it('pages by ten', () => {
    expect(TAKES_PAGE_SIZE).toBe(10);
  });
});
