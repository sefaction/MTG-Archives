# Scan navigation target visibility

Issue: https://github.com/sefaction/MTG-Archives/issues/689

Scan cards uses a sticky Batch progress panel whose height changes with viewport width, buttons and alerts. Fixed scroll offsets could place Inventory, saved-card or capture controls behind that panel. The component now measures the actual summary height, observes resizing, and applies that height plus 16 pixels to its local scroll targets. Programmatic jumps measure immediately after the relevant state update; Back to matches waits until Inventory is hidden.

This changes navigation layout only. Review saving, proposal identities, correction policy, scanner acquisition, ownership, capacity and explicit Inventory commits are unchanged.

## Baseline

On the unchanged cumulative local app, an owned 320×900 browser fixture saved three actual reviews and zero Inventory entries/commits. The bulk handoff's Inventory target started at 224px while the sticky panel ended at 296px. The strict visibility assertion failed as expected. Two baseline reports are retained privately, including the counted actual-API result. Owned accounts, correction records and files were cleaned; original source projections and service state were conserved.

## Qualification in progress

The new owned desktop/phone test covers bulk handoff, Back to matches, review/capture links, next awaiting card, keyboard handoff, resizing, a wrapping blocked-draft alert and reload. It requires all destinations to clear the actual panel, remain in the viewport, avoid horizontal overflow, and preserve three saved reviews with zero Inventory entries/commits. Controlled GET suggestions isolate layout; actual POST saves are used. These fixtures do not establish recognition accuracy or signed proposal attribution.

Type/build, cumulative affected browser regressions, source/service/native parity and fresh original-byte integrity gates remain pending. No physical scanner feed or production acceptance is claimed. Issue689 remains open until this batch receives its own individual approval and merges.
