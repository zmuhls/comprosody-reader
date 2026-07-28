import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  announceLogoutIntent: vi.fn(),
  clearSession: vi.fn(),
  redirectToLogin: vi.fn(),
}));

vi.mock('../../lib/session', () => ({
  announceLogoutIntent: mocks.announceLogoutIntent,
  clearSession: mocks.clearSession,
  redirectToLogin: mocks.redirectToLogin,
}));

import { LogoutControl } from './LogoutControl';

describe('LogoutControl', () => {
  beforeEach(() => {
    mocks.announceLogoutIntent.mockReset();
    mocks.clearSession.mockReset();
    mocks.redirectToLogin.mockReset();
  });

  it('logs out and leaves no authenticated page in browser history', async () => {
    mocks.clearSession.mockResolvedValue(undefined);
    render(<LogoutControl />);

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));

    expect(mocks.announceLogoutIntent).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(mocks.clearSession).toHaveBeenCalledOnce();
      expect(mocks.redirectToLogin).toHaveBeenCalledOnce();
    });
  });

  it('shows a visible retry state and succeeds on retry', async () => {
    mocks.clearSession
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    render(<LogoutControl />);

    fireEvent.click(screen.getByRole('button', { name: /log out/i }));

    const retry = await screen.findByRole('button', {
      name: /retry log out/i,
    });
    expect(screen.getByText('Could not end this session')).toBeTruthy();

    fireEvent.click(retry);

    await waitFor(() => {
      expect(mocks.clearSession).toHaveBeenCalledTimes(2);
      expect(mocks.redirectToLogin).toHaveBeenCalledOnce();
    });
  });
});
