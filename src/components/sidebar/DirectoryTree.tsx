import { useStorage } from '../../hooks/useStorage';
import { useDirectoryTree } from '../../hooks/useDirectoryTree';
import { TreeNode } from './TreeNode';

interface Props {
  query?: string;
}

export function DirectoryTree({ query = '' }: Props) {
  const { directories, entries } = useStorage();
  const tree = useDirectoryTree(directories, entries, query);

  if (tree.length === 0) {
    const hasAny =
      Object.keys(entries).length > 0 || Object.keys(directories).length > 0;
    return (
      <div className="px-5 py-8 text-sm text-text-muted">
        {query.trim() !== '' && hasAny
          ? 'no matches'
          : 'No entries yet. Start a take or create a folder to begin organizing the draft space.'}
      </div>
    );
  }

  return (
    <div className="py-2">
      {tree.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
}
