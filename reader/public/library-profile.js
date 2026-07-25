function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function sameDirectory(left, right) {
  return (left ?? null) === (right ?? null);
}

function resequence(items, groupField = 'directoryId') {
  const groups = new Map();
  for (const item of items) {
    const key = item[groupField] ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.position - b.position);
    group.forEach((item, position) => { item.position = position; });
  }
}

export function directoryChildren(profile, parentId = null) {
  return profile.directories
    .filter((directory) => sameDirectory(directory.parentId, parentId))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export function flattenDirectories(profile, parentId = null, depth = 0) {
  return directoryChildren(profile, parentId).flatMap((directory) => [
    { ...directory, depth },
    ...flattenDirectories(profile, directory.id, depth + 1),
  ]);
}

export function directoryDescendants(profile, directoryId) {
  const result = new Set();
  const visit = (parentId) => {
    for (const child of directoryChildren(profile, parentId)) {
      result.add(child.id);
      visit(child.id);
    }
  };
  visit(directoryId);
  return result;
}

export function catalogForDirectory(catalog, profile, directoryId = null) {
  const placementByBook = new Map(profile.books.map((item) => [item.book, item]));
  return catalog
    .filter((book) => directoryId === null || sameDirectory(placementByBook.get(book.book)?.directoryId, directoryId))
    .sort((left, right) => {
      const leftPlacement = placementByBook.get(left.book);
      const rightPlacement = placementByBook.get(right.book);
      if (directoryId === null) {
        const leftDirectory = leftPlacement?.directoryId ?? '';
        const rightDirectory = rightPlacement?.directoryId ?? '';
        if (leftDirectory !== rightDirectory) return leftDirectory.localeCompare(rightDirectory);
      }
      return (leftPlacement?.position ?? 0) - (rightPlacement?.position ?? 0);
    });
}

export function createDirectory(profile, name, parentId = null, id = crypto.randomUUID()) {
  const next = clone(profile);
  const siblings = directoryChildren(next, parentId);
  next.directories.push({
    id,
    name: String(name).trim().normalize('NFC'),
    parentId: parentId || null,
    position: siblings.length,
  });
  return next;
}

export function renameDirectory(profile, directoryId, name) {
  const next = clone(profile);
  const target = next.directories.find((directory) => directory.id === directoryId);
  if (target) target.name = String(name).trim().normalize('NFC');
  return next;
}

export function moveDirectory(profile, directoryId, parentId = null) {
  const next = clone(profile);
  const target = next.directories.find((directory) => directory.id === directoryId);
  if (!target || directoryId === parentId) return next;
  if (directoryDescendants(next, directoryId).has(parentId)) return next;
  target.parentId = parentId || null;
  target.position = directoryChildren(next, target.parentId).filter((item) => item.id !== directoryId).length;
  resequence(next.directories, 'parentId');
  return next;
}

export function deleteDirectory(profile, directoryId) {
  const next = clone(profile);
  const target = next.directories.find((directory) => directory.id === directoryId);
  if (!target) return next;
  for (const child of next.directories) {
    if (child.parentId === directoryId) child.parentId = target.parentId;
  }
  for (const placement of next.books) {
    if (placement.directoryId === directoryId) placement.directoryId = target.parentId;
  }
  next.directories = next.directories.filter((directory) => directory.id !== directoryId);
  resequence(next.directories, 'parentId');
  resequence(next.books);
  return next;
}

export function reorderDirectory(profile, directoryId, delta) {
  const next = clone(profile);
  const target = next.directories.find((directory) => directory.id === directoryId);
  if (!target) return next;
  const siblings = directoryChildren(next, target.parentId);
  const index = siblings.findIndex((directory) => directory.id === directoryId);
  const other = siblings[index + delta];
  if (!other) return next;
  [target.position, other.position] = [other.position, target.position];
  return next;
}

export function moveBook(profile, book, directoryId = null) {
  const next = clone(profile);
  const target = next.books.find((placement) => placement.book === book);
  if (!target) return next;
  target.directoryId = directoryId || null;
  target.position = next.books.filter((placement) => (
    placement.book !== book && sameDirectory(placement.directoryId, target.directoryId)
  )).length;
  resequence(next.books);
  return next;
}

export function reorderBook(profile, book, delta) {
  const next = clone(profile);
  const target = next.books.find((placement) => placement.book === book);
  if (!target) return next;
  const siblings = next.books
    .filter((placement) => sameDirectory(placement.directoryId, target.directoryId))
    .sort((a, b) => a.position - b.position);
  const index = siblings.findIndex((placement) => placement.book === book);
  const other = siblings[index + delta];
  if (!other) return next;
  [target.position, other.position] = [other.position, target.position];
  return next;
}
