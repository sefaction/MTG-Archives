# Direct scan-review finish choices

Issue #564. Direct Nonfoil and Foil buttons are available beside the proposed
printing in Simple review and above the full Advanced editor. A finish change
requires one button activation, followed by the existing explicit review save;
opening the printing-correction editor and its select is no longer necessary.

Buttons reflect the draft choice with aria-pressed and disable finishes excluded
by the selected printing's known finish list. Etched and Unknown remain available
through the full correction editor; an etched-only printing cannot be coerced to
Foil/Nonfoil. Unknown/empty finish availability retains the existing validation
policy. Original bytes, selected printing, condition, language, placement and
saved reviews are unchanged until the user explicitly saves the review.

Simple finish edits keep their compact Save/Cancel controls. Cancel restores the
saved/default choice. The existing durable draft, polling, revision/conflict and
refresh recovery continue to protect changes. Restored drafts retain the full
editor. Saving a review never adds stock; committed cards have no quick finish or
review-save controls. Explicit Inventory confirmation remains separate.

This batch is stacked on recognition queue PR #567 (commit8336640), whose three
checks passed. Both PRs require independent merge approval. The local app contains
both batches plus previously approved scanner framing/printing reuse/preview work.

Validation: TypeScript,760units, verified-installer Docker production build and
full verification passed (28browser checks;83 explicit opt-in skips). Focused
desktop1366/phone390 finish tests and existing draft/scan-preview regressions pass
(five checks collectively). Initial new-fixture cleanup/save-timing mistakes were
corrected and both final finish checks pass; all owned rows/files were removed. New tests use owned controlled printing/image fixtures, including
foil-only, etched-only and unknown availability; they explicitly preview/commit one
owned reviewed card and then remove only their fixtures. No physical scanner,
production operation or change to existing user Inventory is involved.

Loaded review source:507 inputs, digest
2cdca53abede3b00af6b1e1ecf3d6a0a08e1c14e1600850f7f026b3d5fecbda9;
web image sha256:6f7472b4da262892ecb724b91834a5830805535679af02970a57eac42e023680,
loginHTTP200. All prior Compose layers/data/model mounts and native queue/visual/
printing images remain. Overlay: primary .local-data/import-quick-finish-review.yml.