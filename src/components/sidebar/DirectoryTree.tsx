import { useStorage } from '../../hooks/useStorage';
import { useDirectoryTree } from '../../hooks/useDirectoryTree';
import { TreeNode } from './TreeNode';

export function DirectoryTree() {
  const { directories, entries } = useStorage();
  const tree = useDirectoryTree(directories, entries);

  if (tree.length === 0) {
    return (
      <div className="px-3 py-6 text-text-muted text-xs text-center">
        No entries yet. Create one to start.
      </div>
    );
  }

  return (
    <div className="py-1">
      {tree.map((node) => (
        <TreeNode key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
}
