# Card scan input

Follow-up to crop #469/#470 and review feedback, tracked in #480.

Before choosing library files, select **Library image type → Card scan · keep
full image** for one already framed card per file. This bypasses contour/border
localization, retains all four image edges and normalizes the whole frame through
the same geometry function used by photo processing. Sideways/upside-down cards
still use existing orientation handling. Use **Photo** when the card has camera
background around it; in-app camera captures always use Photo.

The choice is saved with each browser queue item and immutable AcquisitionPhoto,
checked on upload replay, and delivered to background OCR/image matching. Older
photos/queued receipts default to Photo. Choosing another mode does not change
existing uploads. To retry an earlier uncommitted card, explicitly retake/reselect
its file with Card scan selected. Existing review/ownership/revision and commit
rules continue to apply. Original bytes and digests remain unchanged.

Review labels these results **Card scan: full image retained; border detection
skipped.** The full-frame corners describe normalization, not detected physical
edges or proof that the image contains a card. A blank/wrongly selected image
still requires review. This option is for one framed card, not a flatbed page
containing several cards. It cannot recover a footer already missing from the
original source file.

Printing registration continues to receive the original uncut image, as before.
There is no second scanner preprocessing/recognition route, brand-specific logic,
new card counter, confidence threshold or automatic Inventory action. The
independent hardware backend #474 is excluded from this branch.

## Verification

- Model-free geometry checks preserve white-border/footer pixels and all corners
  through all four quarter turns, with contour heuristics prohibited.
- Native hint tests retain raw-photo compatibility and reject unsupported hints,
  private metadata and oversized images. Original bytes are preserved.
- Persistence checks verify duplicate uploads retain the mode, conflicting replay
  cannot change it, and canonical jobs retain it across finalize retries.
- Local browser coverage compares the same real scan in Photo and Card scan
  modes, checks complete corners/OCR orientations, image review and no Inventory
  writes. The repeated input is functional evidence, not an independent accuracy
  sample. Pending/final outcomes and build provenance are in the checkpoint/PR.

The new 90-file user corpus is reserved until this implementation is fixed. It
will measure new-material accuracy separately; art cards and unresolved releases
must remain explicit rather than being forced into playable-card identities.
