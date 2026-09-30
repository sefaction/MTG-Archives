# Fast scan printing corrections

Issue #520 under the standard-user workflow audit (#506). Based on #514/#488;
scanner helper changes are separate PRs.

## User flow

- Correct (or the proposed printing image) opens and focuses the card name.
  Search is directly available. The proposed name is selected for replacement;
  no search or review is submitted merely by opening the editor.
- Search by name or set/collector number, select the printing image, and save.
  On desktop the editor sits beside the scan/printing pair; phone layouts stack.
- A valid chosen finish is retained. A printing with one supported finish uses
  that finish. An unsupported, ambiguous finish stays explicit. Condition and
  destination do not change when selecting another printing.
- Save and next saves through the existing versioned review endpoint, then
  focuses the next card awaiting a saved review in acquisition order. It wraps
  at the end, skips committed/saved/unavailable originals, and reports when no
  other card awaits review. It does not infer a new confidence threshold.
- Ctrl+Enter saves; Ctrl+Shift+Enter saves and advances inside the editor.
  Next awaiting review navigates without saving or discarding dirty edits.
  A failed save does not advance. Inventory addition remains a separate action.

## Evidence and limits

The controlled three-photo browser case uses real saved originals, catalog
rows, revisions, review writes, location/section and metadata. Suggestions,
printing images and search results are controlled presentation fixtures; they
are not independent recognition or physical-scanner evidence. It checks focus,
search, sole-finish selection, condition, asynchronous suggestion reordering,
filter retention, keyboard save-and-next past an already reviewed card, reload,
destination/metadata preservation and zero Inventory writes. Original failure
evidence from a selector and fixture lease race is retained privately; both test
setup problems were corrected. The final desktop-inline layout passed1/1 in
17.3seconds on the loaded cumulative image `9ad81a8c`, with desktop/320px layout
checks and inspected screenshots. Four focused display/navigation/preflight
tests, typecheck and focused lint also passed. Exact-head CI is recorded on GitHub.

The ordinary wrong-name task uses six explicit actions: Correct, replace name,
submit search, select printing, set condition if needed, save-and-next. The
previous extra search disclosure is gone. A proposed alternate can be selected
and saved without a search. These counts describe the tested controls, not
timed usability or a recognition accuracy benchmark.

Dirty rows remain mounted across filtering/navigation. Polling refreshes
evidence without replacing drafts. A concurrent saved revision still requires
reload; keyboard shortcuts do not bypass validation or revision checks. Large
recognition throughput, native driver failures, continuous next-batch defaults,
and public helper distribution remain separate audit work.

Opted-in local check:

```powershell
$env:MTG_LOCAL_PILOT_TEST='1'
npm run ui:test -- tests/ui/acquisition-fast-corrections.spec.ts
```
