import { useLiveQuery } from 'dexie-react-hooks';
import { useLibrary } from '../../context/LibraryContext';
import {
  deletePassageLink,
  listPassageLinksForEntry,
} from '../../lib/passageLinks';
import { Icon } from '../ui/Icon';

export function LinkedPassages({ entryId }: { entryId: string }) {
  const { openPublication } = useLibrary();
  const links = useLiveQuery(
    () => listPassageLinksForEntry(entryId),
    [entryId],
    [],
  );

  if (!links.length) return null;

  return (
    <section aria-label="Passages linked to this note" className="linked-passages">
      <div className="linked-passages-heading">
        <span>Linked {links.length === 1 ? 'passage' : 'passages'}</span>
        <small>
          {links.length} source {links.length === 1 ? 'anchor' : 'anchors'}
        </small>
      </div>
      <div className="linked-passages-list">
        {links.map((link) => (
          <article className="linked-passage" key={link.id}>
            <button
              className="linked-passage-open"
              onClick={() =>
                openPublication(link.publicationId, link.selector.cfiRange)
              }
              type="button"
            >
              <span>
                {link.publicationTitle}
                <small>{link.publicationAuthor}</small>
              </span>
              <blockquote>“{link.selector.exact}”</blockquote>
              <Icon name="chevron-right" size={14} />
            </button>
            <button
              aria-label={`Unlink passage from ${link.publicationTitle}`}
              className="icon-button linked-passage-remove"
              onClick={() => void deletePassageLink(link.id)}
              type="button"
            >
              <Icon name="x" size={12} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
