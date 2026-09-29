# Stamp visibility qualification

Recognition #463 remains open. This is a bounded printing-detector correction,
independently based on main after #499. It changes no OCR, image preparation,
reference images, retrieval model, stamp thresholds, human review or Inventory.

## Reproduction

The preserved Boggart Ram-Gang scan has a complete lower-left planeswalker mark.
The existing distributed registration is strong (584 inliers, 0.833 support),
but 1.25% of its larger stamp search margin lies outside the original photo.
Version 4 rejects the whole region before inspecting the symbol. The existing
public-template match scores 0.942 when that early rejection is isolated.
That diagnostic bypass is not the implementation or permission to infer a stamp.

## Correction

Registration retains its observed-pixel mask internally. The native printing
runtime requires a fully observed stamp core, sufficient resolution and the
existing readable-footer checks. Each template placement must be fully covered
by observed pixels; placements touching interpolation/padding are excluded.
Thus clipping outside the actual symbol does not hide a visible mark, while a
clipped core, invalid alignment, blur, glare or inconclusive match stays unknown.
The shifted core used for absence comparison also requires observed pixels.
Absence still requires a verified unstamped reference and local agreement.

The mask is transient within one native request; it is not serialized into the
bounded worker response or stored as another image. The detector version and
existing source-hashed runtime descriptor change. The native/app identity checks
remain exact, and existing saved human corrections cannot be overwritten.

## Qualification

Eighteen focused Python printing/runtime/cache guards pass, including clipped
search margins, partially hidden templates, blur, absence visibility, failed
registration and cached/uncached registration parity. The initial test command
had a module mount/import-path error, corrected without changing application
behavior. Real development replay and the local browser gate are pending.

`qualify_stamp_visibility.py` reuses each preserved runtime result's actual
ordered candidate references and verifies original hashes. Labels score only
the output. The selected 31 development scans include all 12 stamped scans
from the two retained batches and 19 deterministic unstamped controls.
Fresh baseline/current registration must remain exactly equal except for the
stamp visibility flag. Comparing only saved JSON initially stopped on final
floating-point digits after JavaScript/JSONB serialization. That failure is
retained. The final qualifier loads the preserved baseline source alongside the
new source, requires exact registration parity, and also reproduces the saved
stamp outcome. It does not loosen the parity check or runtime identity checks.
The initial replay failed on a diagnostic code-hash path before saving a result;
its failure is retained and the helper path is corrected.

Only the local printing worker is reloaded. The web/OCR/visual images, source
manifest and model/index settings remain unchanged. Built/source byte hashes
match; the native descriptor changes only the printing and stamp-policy hashes.
The ordinary Boggart browser check is running with no fixture priorities or
worker result injection, a fixed ten-minute printing gate, preserved location,
correction/reload and zero Inventory checks.

This is reused development-stage evidence, not independent exact-printing
accuracy. The known difficult Android stamp and broader throughput/automatic
confirmation gates remain separate; a low score does not become absence.
