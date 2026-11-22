// Three-way merge of the library, used when another tab saves.
//
//  base   - the library as this tab last saw it in storage
//  local  - this tab's current library (may have unsaved edits)
//  remote - what the other tab just saved
//
// The merge is per book. A book only this tab changed keeps this tab's
// version; a book only the other tab changed takes theirs; when both changed
// the same book, the most recently edited version wins, and an edit beats a
// delete so no writing is thrown away.

const byId = (books) => new Map(books.map((b) => [b.id, b]));
const same = (a, b) => a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));

function pick(baseBook, localBook, remoteBook) {
  // Reference check: an unedited book is the same object this tab last saved.
  const localChanged = localBook !== baseBook;
  const remoteChanged = !same(remoteBook, baseBook);

  if (!localChanged) return remoteBook;
  if (!remoteChanged) return localBook;
  if (!localBook) return remoteBook;
  if (!remoteBook) return localBook;
  // On a tie, keep what this tab has.
  return localBook.updatedAt >= remoteBook.updatedAt ? localBook : remoteBook;
}

export function mergeLibraries(base, local, remote) {
  const baseMap = byId(base);
  const localMap = byId(local);
  const remoteMap = byId(remote);

  const result = [];
  const placed = new Set();
  const add = (id) => {
    if (placed.has(id)) return;
    placed.add(id);
    const book = pick(baseMap.get(id), localMap.get(id), remoteMap.get(id));
    if (book) result.push(book);
  };

  // Books new in this tab go first, as new books do; then the other tab's order.
  for (const b of local) if (!baseMap.has(b.id) && !remoteMap.has(b.id)) add(b.id);
  for (const b of remote) add(b.id);
  for (const b of local) add(b.id);
  return result;
}
