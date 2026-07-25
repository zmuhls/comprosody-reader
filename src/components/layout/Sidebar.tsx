import { memo, useEffect, useState } from 'react';
import { DirectoryTree } from '../sidebar/DirectoryTree';
import { EntryActions } from '../sidebar/EntryActions';
import { Icon } from '../ui/Icon';
import { useApp } from '../../context/AppContext';
import { LibrarySection } from '../library/LibrarySection';
import { cadenceApiUrl } from '../../lib/urls';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar = memo(function Sidebar({ isOpen, onClose }: SidebarProps) {
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  const [openPanel, setOpenPanel] = useState<'voice' | 'settings' | null>(null);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    window.matchMedia('(max-width: 820px)').matches,
  );
  const { voiceProfile, storageReady } = useApp();

  useEffect(() => {
    const query = window.matchMedia('(max-width: 820px)');
    const update = () => setIsNarrowViewport(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

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

  return (
    <>
      <button
        aria-label="Close note directory"
        aria-hidden={!isOpen}
        className={`sidebar-backdrop ${isOpen ? 'is-visible' : ''}`}
        onClick={onClose}
        tabIndex={isOpen ? 0 : -1}
        type="button"
      />
      <aside
        aria-hidden={isNarrowViewport && !isOpen}
        className={`sidebar ${isOpen ? 'is-open' : ''}`}
        inert={isNarrowViewport && !isOpen ? true : undefined}
      >
        <header className="sidebar-header">
          <div>
            <h1>Cadence</h1>
            <p>Speak into thought.</p>
          </div>
          <button
            aria-label="Close note directory"
            className="icon-button sidebar-close"
            onClick={onClose}
            type="button"
          >
            <Icon name="x" size={17} />
          </button>
        </header>

        <div className="sidebar-workspace">
          <LibrarySection onSelectPublication={onClose} />

          <div className="notes-section">
            <div className="sidebar-section-heading">
              <span>Notes</span>
            </div>
            <EntryActions />
            <nav aria-label="Note directory" className="sidebar-tree">
              <DirectoryTree onSelectEntry={onClose} />
            </nav>
          </div>
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
              <p>
                Cadence learns only from transcripts and prosody saved in this
                browser. Raw audio is not retained.
              </p>
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
              <p>
                Transcription provider and fidelity controls live beside the
                recording dock, where their effect is visible.
              </p>
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
        </div>
      </aside>
    </>
  );
});
