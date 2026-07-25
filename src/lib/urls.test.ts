import {
  CADENCE_API_BASE_URL,
  cadenceApiUrl,
  resolveCadenceApiBaseUrl,
} from './urls';

describe('Cadence API URLs', () => {
  it('keeps local development on the Vite API proxy', () => {
    expect(CADENCE_API_BASE_URL).toBe('/api');
    expect(cadenceApiUrl('/health')).toBe('/api/health');
    expect(cadenceApiUrl('transcribe?provider=local')).toBe(
      '/api/transcribe?provider=local',
    );
  });

  it('uses the Readings studio gateway for an unconfigured production build', () => {
    expect(resolveCadenceApiBaseUrl(undefined, true)).toBe('/studio/api');
    expect(resolveCadenceApiBaseUrl('', true)).toBe('/studio/api');
  });

  it('supports an explicit local or hosted API base without duplicate slashes', () => {
    expect(
      resolveCadenceApiBaseUrl('http://127.0.0.1:3001/api///', false),
    ).toBe('http://127.0.0.1:3001/api');
  });
});
