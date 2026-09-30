# Browser correction drafts

Issue #530, following the individually unapproved #521/#514/#488 UI stack.
Scanner #528 and recognition algorithms remain independent.

Selecting a printing or editing review metadata keeps a validated local browser
draft for that account, batch and photo. Reloading or leaving and returning to
the page restores the printing, finish, condition, language and search fields.
The page labels it an unsaved correction. It does not save a review to the server
or add anything to Inventory.

The draft retains its original server review revision. If another tab/user has
saved a different review, restoration explains the conflict and Save still uses
the old revision. Existing server ownership, finish validation and stale-review
checks remain authoritative. Cancel changes or Reload review explicitly loads
the current server review and removes the local draft. Successful review save
and a visible committed copy also clear it. A write identity checks the latest
observed cache entry before removing it, preserving a newer observed draft from
another tab. This is not an atomic cross-tab synchronization mechanism; server
review revision checks provide the authoritative conflict protection.

Only printing display metadata and editor fields are stored, with a strict
schema and a 16-KiB per-entry bound. No scan pixels, original image bytes,
connection secrets or recognition debug payloads enter this cache. Storage
failure does not block correction or explicit server save; it tells the user to
save before leaving. Invalid saved content is not rendered as a recovered draft.

## Evidence and limits

The controlled three-photo baseline lost its editor and LP condition on reload;
the failure log is kept locally. Focused tests cover exact snapshot/original
revision recovery, account/batch/photo separation, malformed/oversized content,
quota failure, explicit removal and preservation of newer writes. Typecheck and
focused lint pass. The local three-photo browser case passed 1/1 in 12.1 seconds
after correcting two fixture assumptions: restored choices are Possible
printings, and explicit Cancel completes its asynchronous GET before cache
removal is asserted. The failure logs/traces remain private. It exercises
suggestion updates, filtering, reload and navigation, explicit
keyboard save, stale-review rejection/discard and genuinely blocked browser
storage, while retaining destination/original digest and zero Inventory writes.
The final unsaved-status label is verified against the rebuilt image in the
checkpoint. Corrected independent scanner storage/recovery cases passed 2/2.

This is local browser recovery, not cross-device synchronization or a backup of
Inventory. Drafts are read when their card review enters view; it does not scan
all browser keys or render every review editor on page load. Unvisited drafts
can remain in this browser until their review is saved/discarded or browser data
is cleared. #532 tracks exclusion of unsaved/cached corrections from bulk and
Inventory actions; the current controls do not yet consult that state. Batch
defaults are not part of this per-card draft. Recognition
accuracy and large-list throughput require their own evidence.
