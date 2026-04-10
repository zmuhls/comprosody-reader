import { useStorage } from '../../hooks/useStorage';
import { useDirectoryTree } from '../../hooks/useDirectoryTree';
import { TreeNode } from './TreeNode';

export function DirectoryTree() {
  const { directories, entries } = useStorage();
  const tree = useDirectoryTree(directories, entries);

  if (tree.length === 0) {
    return (
      <div className="px-5 py-8 text-sm text-text-muted">
        No entries yet. Start a take or create a folder to begin organizing the draft space.
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
