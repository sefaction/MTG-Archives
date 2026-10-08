# Preserve non-Latin name evidence

Issue [677](https://github.com/sefaction/MTG-Archives/issues/677) records an evidence-attribution failure. The old name key discarded non-ASCII letters after decomposition. Distinct Cyrillic titles ending in `123` therefore shared the key `123`: a synthetic second-card title with the first card's footer falsely received `TITLE_EXACT` and automatic acceptance. A readable all-Cyrillic printed-name alias instead disappeared from title retrieval. A frozen local metadata projection contains 517 non-Latin printed/face alias entries, 516 of which were entirely erased; these are stored entries, not independent images or unique printing families.

The shared name key retains Unicode letters, numbers and attached non-Latin marks while preserving established Latin accent/punctuation folding. Local printed/face aliases and unlocalized whole-photo hints use the same key. Distinct Japanese dakuten and Cyrillic letter marks remain distinct. Orphan marks and punctuation alone do not become names.

Non-Latin-only exact title agreement remains explicitly review-only. This does not qualify an OCR model for new languages or change the existing minimum-length, orientation, footer language, stamped-reprint or Inventory safeguards. Existing normalized ASCII title agreement keeps its original gate. Whole-photo hints retain their unlocalized status and supply no title/footer coordinates or automatic confirmation.

Catalog interpretation changes to `catalog-reconciliation-unicode-names-v9`, with text policy `metadata-unicode-name-evidence-v7`. Eligible unreviewed saved metadata refreshes from existing OCR. Native descriptors, raw job identity and proposal schema version remain unchanged. Existing human reviews remain authoritative.

Focused tests pass, including the false agreement, aliases, combining marks, script review gate, orientation separation and whole-photo evidence. Full feature core passes all 849 tests, type checking, production build and 13 client manifests. An initial added database fixture had an inferred-array typing error; the fixture was typed before the successful core run. Database, cumulative Docker and browser checks are pending.

Frozen baseline/current replay uses identical 118,486-card metadata and 314 reused development observations, including saved whole-photo hints when present. Proposals remain unchanged. This is regression coverage, not independent recognition accuracy or language qualification. A separate adjacent-title-fragment audit over the same 314 observations/592 readings found no newly recoverable candidates from exact two/three-fragment joins, so that rule was not implemented.

This batch is based on the separately unapproved footer pairing PR676. Its eventual PR must be retargeted and requalified against main after676 merges; it still needs its own individual merge approval. Broader463/307 remain open.
