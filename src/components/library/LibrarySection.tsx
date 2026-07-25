import { useLibrary } from '../../context/LibraryContext';
import { Icon } from '../ui/Icon';
import { readingShelfUrl } from '../../lib/libraryApi';

interface LibrarySectionProps {
  onSelectPublication: () => void;
}

export function LibrarySection({
  onSelectPublication,
}: LibrarySectionProps) {
  const {
    activePublication,
    catalog,
    error,
    isLoading,
    openPublication,
    refresh,
  } = useLibrary();

  return (
    <section aria-labelledby="library-section-label" className="library-section">
      <div className="sidebar-section-heading">
        <span id="library-section-label">Library</span>
        <a href={readingShelfUrl()} title="Open the full reading shelf">
          Shelf
        </a>
      </div>

      {isLoading ? (
        <p className="library-status">Opening shelf…</p>
      ) : error ? (
        <div className="library-status">
          <p>{error}</p>
          <button onClick={() => void refresh()} type="button">
            Retry
          </button>
        </div>
      ) : (
        <div className="library-list">
          {catalog.map((publication) => (
            <button
              aria-current={
                activePublication?.id === publication.id ? 'page' : undefined
              }
              className={`library-row ${
                activePublication?.id === publication.id ? 'is-active' : ''
              }`}
              key={publication.id}
              onClick={() => {
                openPublication(publication.id);
                onSelectPublication();
              }}
              type="button"
            >
              <Icon name="book" size={14} />
              <span>
                <strong>{publication.title}</strong>
                <small>{publication.author}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
