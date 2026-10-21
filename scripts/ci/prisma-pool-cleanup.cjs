// Diagnostic failure must never skip the independent exact-owned removal attempt.
module.exports = function cleanupOwnedContainers(ids, {collect, remove, failed}) {
  for (const id of [...ids].reverse()) {
    try { collect(id); } catch (error) { failed(error, 'diagnostic', id); }
    try { remove(id); } catch (error) { failed(error, 'removal', id); }
  }
};
