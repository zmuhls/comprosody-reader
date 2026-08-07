import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Icon } from '../ui/Icon';
import { useApp } from '../../context/AppContext';
import { WorkspaceNavigator } from '../library/WorkspaceNavigator';
import { cadenceApiUrl } from '../../lib/urls';
import { LogoutControl } from './LogoutControl';
import { LexiconPanel } from '../sidebar/LexiconPanel';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  returnFocusTarget: HTMLElement | null;
}

export const Sidebar = memo(function Sidebar({
  isOpen,
  onClose,
  returnFocusTarget,
}: SidebarProps) {
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [openPanel, setOpenPanel] = useState<'voice' | 'settings' | null>(null);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    window.matchMedia('(max-width: 900px)').matches,
  );
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { voiceProfile, storageReady } = useApp();

  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const update = () => setIsNarrowViewport(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!isNarrowViewport) return;
    if (isOpen) {
      returnFocusRef.current = returnFocusTarget;
      const frame = window.requestAnimationFrame(() =>
        closeButtonRef.current?.focus(),
      );
      return () => window.cancelAnimationFrame(frame);
    }
    const returnTarget = returnFocusRef.current;
    returnFocusRef.current = null;
    if (returnTarget?.isConnected) returnTarget.focus();
  }, [isNarrowViewport, isOpen, returnFocusTarget]);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      fetch(cadenceApiUrl('/health'))
        .then((response) => {
          if (!cancelled) setServerOk(response.ok);
        })
        .catch(() => {
          if (!cancelled) setServerOk(false);
        });
    };

    check();
    const id = window.setInterval(check, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const averagePace = voiceProfile.prosody.rolling?.pace.mean ?? 0;
  const vocabulary = voiceProfile.vocabulary.terms
    .filter((term) => term.count > 1)
    .slice(0, 3)
    .map((term) => term.preferred);

  const handleSidebarKeyDown = (
    event: KeyboardEvent<HTMLElement>,
  ) => {
    if (!isNarrowViewport || !isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), '
          + 'select:not([disabled]), textarea:not([disabled]), '
          + '[tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => !element.hasAttribute('inert'));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        aria-label="Close workspace menu"
        aria-hidden="true"
        className={`sidebar-backdrop ${isOpen ? 'is-visible' : ''}`}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-label="Workspace"
        aria-hidden={isNarrowViewport ? !isOpen : undefined}
        aria-modal={isNarrowViewport && isOpen ? true : undefined}
        className={`sidebar ${isOpen ? 'is-open' : ''}`}
        inert={isNarrowViewport && !isOpen ? true : undefined}
        onKeyDown={handleSidebarKeyDown}
        ref={sidebarRef}
        role={isNarrowViewport ? 'dialog' : 'complementary'}
      >
        <div className="sidebar-header">
          <div>
            <h1>Comprosody</h1>
            <p>Agentic Reader \ Vocal Notes</p>
          </div>
          <button
            aria-label="Close workspace menu"
            className="icon-button sidebar-close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <Icon name="x" size={17} />
          </button>
        </div>

        <div className="sidebar-workspace">
          <WorkspaceNavigator onNavigate={onClose} />
          <LexiconPanel />
        </div>

        <div className="sidebar-footer">
          {openPanel === 'voice' ? (
            <section className="sidebar-popover" aria-label="Local voice profile">
              <div className="sidebar-popover-heading">
                <span>Voice profile</span>
                <button
                  aria-label="Close voice profile"
                  className="icon-button"
                  onClick={() => setOpenPanel(null)}
                  type="button"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
              <p>Learned in this browser. Audio is not retained.</p>
              <dl className="profile-mini-grid">
                <div>
                  <dt>Sessions</dt>
                  <dd>{voiceProfile.source.prosodyEntryCount}</dd>
                </div>
                <div>
                  <dt>Avg. pace</dt>
                  <dd>
                    {averagePace
                      ? `${Math.round(averagePace)} wpm`
                      : 'Learning'}
                  </dd>
                </div>
              </dl>
              {vocabulary.length > 0 ? (
                <p className="profile-vocabulary">
                  Familiar vocabulary: {vocabulary.join(', ')}
                </p>
              ) : null}
            </section>
          ) : null}

          {openPanel === 'settings' ? (
            <section className="sidebar-popover" aria-label="Application status">
              <div className="sidebar-popover-heading">
                <span>Settings</span>
                <button
                  aria-label="Close settings"
                  className="icon-button"
                  onClick={() => setOpenPanel(null)}
                  type="button"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
              <p>Transcription controls sit beside the recording dock.</p>
              <div className="server-state">
                <span
                  className={`server-dot ${storageReady ? 'is-online' : ''}`}
                  aria-hidden="true"
                />
                {storageReady ? 'IndexedDB ready' : 'Opening local database'}
              </div>
              <div className="server-state">
                <span
                  className={`server-dot ${serverOk ? 'is-online' : ''}`}
                  aria-hidden="true"
                />
                {serverOk === null
                  ? 'Checking local service'
                  : serverOk
                    ? 'Local service connected'
                    : 'Local service offline'}
              </div>
            </section>
          ) : null}

          <button
            aria-expanded={openPanel === 'voice'}
            className="sidebar-footer-row voice-profile-row"
            onClick={() =>
              setOpenPanel((current) => (current === 'voice' ? null : 'voice'))
            }
            type="button"
          >
            <span className="voice-mark">
              <Icon name="waveform" size={17} />
            </span>
            <span className="sidebar-footer-copy">
              <strong>Voice profile</strong>
              <small>Learning locally</small>
            </span>
            <Icon name="chevron-down" size={15} />
          </button>

          <button
            aria-expanded={openPanel === 'settings'}
            className="sidebar-footer-row"
            onClick={() =>
              setOpenPanel((current) =>
                current === 'settings' ? null : 'settings',
              )
            }
            type="button"
          >
            <Icon name="settings" size={19} />
            <span className="sidebar-footer-copy">
              <strong>Settings</strong>
              <small>
                {serverOk === null
                  ? 'Checking service'
                  : serverOk
                    ? 'Local service ready'
                    : 'Service offline'}
              </small>
            </span>
          </button>
          <LogoutControl />
        </div>
      </section>
    </>
  );
});
