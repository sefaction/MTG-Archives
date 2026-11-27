# Paired Token and Art card scans

Issue: [#1056](https://github.com/sefaction/MTG-Archives/issues/1056). Brian authorized implementation on November 26, 2026, and selected automatic fi-7160 duplex in one pass. Merge, production and physical scanner operation require their own authority. This extends [the recognition pipeline](RECOGNITION_PIPELINE_DESIGN.md).

## Product flow

Choose Ordinary cards, Double-sided tokens or Art cards when starting a scan batch. Ordinary cards keep their existing simplex controls. Specialized profiles capture both sides and show one physical item with two source images, independent face recognition and one final confirmation. Missing/ambiguous sides stay visibly unresolved. They cannot silently become single-sided copies or shift following pairs.

Tokens identify each actual printed face. Application identities use a sorted multiset of stable catalog printing/face IDs, independent of capture direction and displayed names. Display order is alphabetical with a stable tie-breaker. A/B equals B/A; A/C and different artwork/printing stay distinct. The application identity has no fabricated Scryfall ID. Its two source faces remain linked, searchable by either name and visible through normal Inventory card faces. Count and capacity use physical copies once. Catalog double-faced-token faces remain tied to their actual source printing. Non-token/unknown backs cannot masquerade as a token face; unresolved evidence remains pending.

Art profiles identify the art-series object, never its depicted playable card. Both images contribute recognition evidence; the artwork is the primary display. Explicit unstamped/signature/Planeswalker/other stamp facts are separate from finish and List-card evidence. When the catalog does not distinguish that variant, an application variant retains the real source art-card ID without inventing a catalog printing. Reverse-image cleanup uses ordinary committed-scan retention; identity, variant and provenance remain after images expire.

## Capture and recovery boundaries

One acquisition slot/candidate is one physical item; two current side images share its generation. Existing photos default to FRONT and existing sessions to STANDARD. Each side has its own immutable upload identity/digest, artifact and processing work. Both-side retries use the original slot/side/generation; an explicit retake invalidates the complete previous pair and its final review. Final receipt membership remains unique per physical candidate.

Duplex grouping requires scanner-provided sheet identity plus side, scoped to the durable execution. TWAIN PAPERCOUNT/PAGESIDE and source document information must be checked in the actual driver; adjacent transfer order alone is insufficient. Disable blank removal, preserve originals before publishing metadata, and retain source/DSM restore protections. Unsupported/missing metadata fails automatic pairing explicitly. Reconnects cannot combine a stale half-pair with a new execution. No physical qualification has yet occurred for this new route.

## Implementation and verification

- Explicit profiles and source-bound paired review, with ordinary review/automatic acceptance unable to bypass the specialized confirmation.
- Reuse preparation/OCR/visual/catalog adapters per side, restrict proposals/search to the intended catalog layouts, and keep pairing uncertainty independent of recognition uncertainty.
- Catalog-backed application identities with nullable external catalog IDs; catalog refresh/pricing/export/restore paths must distinguish application identity from external printing. No extrapolated token-pair/art-variant price.
- Standard acquisition commit validates both current sides and the saved source fingerprint, then writes one provenance-preserving Inventory copy, audit and duplicate-safe receipt.
- Qualify pure normalization, actual database ownership/replay/conservation/concurrent capacity, interrupted/missing/reordered/duplicate side cases, ordinary-scan regressions, local desktop/phone workflow, and exact-head CI. Physical feed evidence and independent/user acceptance are separate required observations, not implied by software fixtures.

## Local review and first physical check

Choose the profile in Scan cards ? Card input. The dedicated review shows two source images and the matching references at the same adjustable size. Confirm both sides of each physical item, then Add confirmed to Inventory opens one frozen confirmation for the current batch and visible destination. Unsaved corrections remain excluded. The specialized single-item decision cannot use ordinary bulk or single-photo assistant confirmation.

Set aside / rescan both sides retains the old originals and removes that item from Inventory addition. Start a new explicit duplex batch for its replacement. Repair pairing requires settled capture, a clear-transport acknowledgement after errors, two chosen current originals and explicit physical-item confirmation. Unpair first when either selected source already belongs to a complete pair. Repair keeps immutable original transport identities and reschedules current-source recognition; it does not rewrite captured bytes or automatically align neighboring images.

The server upgrade uses the ordinary stop/pull/start workflow and one automatic migration. No new Compose/environment/model setting is required. Download/install Windows helper 0.5.0 to use the new profiles; ordinary scanning remains compatible with earlier helpers. The duplex route refuses before feeding if required driver capabilities are unavailable.

Physical acceptance is separate from software fixtures. Once Brian authorizes operation and is present at the fi-7160, use a short Token batch and a short Art batch with known faces: verify two retained images per item, actual document/sheet/side metadata, no missing/reversed association, orientation/readability, correct printing choices, canonical reversed-token identity, explicit art stamp choice and one-copy Inventory preview. Do not deliberately cause jams or double feeds; injected software faults cover those recovery boundaries. Record actual images/metadata and recognition uncertainty rather than treating a successful transfer as proof of a match. No physical qualification or production activation is claimed by this document.
