# Physical scanner boundary evaluation

The scanner accuracy target includes the exact name, set and collector number. A correct printing does not establish that its crop follows the physical card. This private tool records and scores those outcomes separately, without sending labels to recognition or changing application decisions.

## Record original-only labels

Use the native OCR dependency image or a local Python environment with Pillow, NumPy and OpenCV. Prepare a dedicated new output path:

```powershell
python tools/recognition-audit/scanner_boundaries.py prepare --photos "C:\path\to\scans" --output .local-data/scanner-boundaries/labels.json
```

The parent output directory must exist. Preparation preserves the originals, hashes their bytes, records EXIF-oriented dimensions and creates a JSON template plus adjacent HTML labeler. Every boundary starts PENDING. Existing outputs are refused. No recognition result, estimated outline or printing label supplies ground truth.

Open the generated HTML locally, choose the original images and enter your name. Mark the intersections of the four straight physical sides clockwise, starting at the top-left. Zoom when needed; rounded corners do not move those line intersections. Save the visible outline, or explicitly mark CLIPPED/UNCERTAIN. A clipped or indistinguishable side must not receive guessed corners. Export labels and use Resume to continue later. Unsaved corner clicks do not become reviewed labels; export preserves pending status. The local page performs no network requests or uploads. Keep exports private with the corpus.

The labeler verifies selected bytes and dimensions before enabling annotation. Resuming rejects changed originals, identity/frame/printing/group metadata, invalid corners or incomplete review attribution. Annotation does not establish reviewer correctness: inspect labels, preferably with a second reviewer, before using them as accuracy evidence.

## Score frozen observations

```powershell
python tools/recognition-audit/scanner_boundaries.py score --photos "C:\path\to\scans" --truth .local-data/scanner-boundaries/reviewed.json --observations .local-data/geometry-baseline.json --output .local-data/scanner-boundaries/results.json --corner-tolerance 5
```

The scorer accepts the existing geometry-audit `samples` format or paired recognition-audit `rounds`, using raw-source native geometry and final proposal IDs. Truth source digests, decoded dimensions and observation identities must match exactly. Duplicate originals/observations and foreign frames are rejected. Missing predictions remain in the labelled-visible denominator. Source/manifest/report/scorer hashes permit replay. The five-pixel default is an explicit diagnostic tolerance; choose and freeze the intended acceptance tolerance before validation rather than tuning it after results.

Visible boundaries report maximum/mean corner error, polygon overlap and physical-card coverage. Cyclic corner starts do not affect geometry scoring. Primary measured, declared/other and saved-layout inferred outcomes remain separate; normalized inferred corners are mapped back to original dimensions. Clipped-source refusal has its own denominator; PENDING/UNCERTAIN do not fabricate a boundary accuracy estimate.

Supply independently verified `expectedScryfallIds` in the frozen truth JSON when scoring printings. Exactly one verified printing permits exact-first scoring; no identity or multiple plausible identities remain unlabelled/ambiguous for that metric. The scorer recomputes from final proposal IDs and ignores a report's expected IDs/correctness claims. It reports correct printings with bad boundaries and joint boundary/printing success separately. Physical-copy grouping and evaluation split stay explicit; this tool never claims random independent population accuracy. Keep development and validation corpora separate and freeze model/policy/truth before unseen validation.

## Qualification

- All21 Python recognition-audit checks pass in the existing bounded, network-disabled native image, including9 boundary controls for source substitution, missing predictions, invalid/source-clipped geometry, cyclic matching, inferred coordinate spaces and printing/truth separation.
- Actual Chromium annotation/export/resume verifies known-position source-coordinate clicks, changed-original/metadata refusal, pending/uncertain labels and desktop/320px wrapping. At25% zoom mouse rasterization introduces less than2 source pixels in this control; use higher zoom for precise physical boundaries. An initial exact-subpixel click assertion was corrected to the actual mouse precision; its failure remains private.
- Actual native measured-control output scored against the browser-exported synthetic outer contour has maximum corner error3.585pixels, overlap0.995778 and coverage approximately1. This demonstrates scoring, not real scanner accuracy. The second control remains explicitly UNCERTAIN.
- All191 supplied JPEGs are prepared read-only. Against their retained actual geometry observations the report contains191 PENDING boundary labels and a null boundary-success fraction. It creates no printing truth or99% claim. All images overlap historical development batches.
- A private reflective-ridge probe across those191 images found no reliable four-side support (67 left-side candidates, zero other complete sides). That rejected experiment remains diagnostic and is not integrated into runtime framing.

This batch adds private tooling and one opt-in browser regression. The qualified local Docker app/native images and recognition policy are unchanged; the actual tool code is exercised through read-only mounts in the existing local native dependency image. Independent physical-boundary/printing acceptance and broader scan functions remain open under #306/#463/#749.
