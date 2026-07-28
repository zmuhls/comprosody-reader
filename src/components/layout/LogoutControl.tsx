import { useState } from 'react';
import {
  announceLogoutIntent,
  clearSession,
  redirectToLogin,
} from '../../lib/session';
import { Icon } from '../ui/Icon';

type LogoutState = 'idle' | 'pending' | 'error';

export function LogoutControl() {
  const [state, setState] = useState<LogoutState>('idle');

  const handleLogout = async () => {
    announceLogoutIntent();
    setState('pending');

    try {
      await clearSession();
      redirectToLogin();
    } catch {
      setState('error');
    }
  };

  const isPending = state === 'pending';
  const hasError = state === 'error';

  return (
    <button
      aria-live="polite"
      className={`sidebar-footer-row sidebar-logout-row ${
        hasError ? 'is-error' : ''
      }`}
      disabled={isPending}
      onClick={handleLogout}
      type="button"
    >
      <Icon name="chevron-right" size={19} />
      <span className="sidebar-footer-copy">
        <strong>
          {isPending ? 'Logging out…' : hasError ? 'Retry log out' : 'Log out'}
        </strong>
        <small>
          {hasError
            ? 'Could not end this session'
            : 'End this private session'}
        </small>
      </span>
    </button>
  );
}
