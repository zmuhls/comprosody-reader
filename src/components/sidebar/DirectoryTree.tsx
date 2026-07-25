import { memo } from 'react';
import { useStorage } from '../../hooks/useStorage';
import { useDirectoryTree } from '../../hooks/useDirectoryTree';
import { TreeNode } from './TreeNode';

interface DirectoryTreeProps {
  onSelectEntry?: () => void;
}

export const DirectoryTree = memo(function DirectoryTree({
  onSelectEntry,
}: DirectoryTreeProps) {
  const { directories, entries } = useStorage();
  const tree = useDirectoryTree(directories, entries);

  if (tree.length === 0) {
    return (
      <div className="directory-tree" role="tree">
        <div className="directory-empty">
          Your notes will live here.
        </div>
      </div>
    );
  }

  return (
    <div className="directory-tree" role="tree">
      {tree.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          onSelectEntry={onSelectEntry}
        />
      ))}
    </div>
  );
});
