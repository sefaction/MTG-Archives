# Deterministic native Python checkout

Native recognition and visual model descriptors deliberately hash raw source bytes.
Windows core.autocrlf previously converted Python LF into CRLF and changed those
identities without changing behavior. The DINOv2 query/index guard correctly
rejected that mismatch. This batch keeps the guard and makes Git checkouts use LF.

## Existing checkout adoption

New Windows/Linux checkouts honor `*.py text eol=lf`. Existing files are not always
rewritten when attributes change. From this repository run:

```text
node scripts/verify-native-source.mjs
node scripts/verify-native-source.mjs --refresh
```

Check mode fails on CRLF. Refresh considers tracked Python inputs only under
`tools/acquisition-eval` and `tools/acquisition-runtime`. Before writing any file,
it requires each normalized change to equal its staged Git blob. Unstaged code
changes block the entire refresh; stage/review intentional edits first. Genuine
source edits keep their new raw fingerprint and may require a newly qualified
index; refresh never edits weights, catalog/index metadata, originals or reviews.

The command reports every scoped SHA256. It is an explicit checkout operation,
not automatic normalization inside the query/index guard. Symlink targets are
rejected. Repeated refresh is idempotent.

## Local evidence, October 1–2

- Two real temporary Git checkout regressions reproduce the pre-policy mismatch,
  then check every tracked native Python fingerprint with autocrlf=true/false/input.
  Existing-checkout adoption, idempotence, unstaged-edit refusal before any write,
  staged genuine-edit preservation and untouched model/index sentinel all pass.
- 23 model-free catalog index/reference/refresh checks pass in Linux Docker,
  including genuine encoder-source, weight/catalog mismatch rejection, rollback,
  published digest/path integrity and partial-index refusal.
- Recovered core verification passed 762 tests with zero failures/skips, typecheck,
  production build and manifest guards. Recovered web, OCR and visual Docker
  builds completed; no interrupted build is assumed successful merely from launch.
- Actual new visual image loaded the existing 112,536 references and verified
  query identity against the existing read-only weights/index. Index SHA256 is
  f860be7b8df7dcf2233fbb8b2ec23e3bbc9286eb6c82e2acae9f892424658430;
  encoder SHA256 is 1e479364cafda6b6975a2b9784c10f61bf3a96a1fb2948213016e17e2fd5c4c4.
  Index bytes stayed unchanged. No corpus rebuild or metadata alteration.
- Cumulative local review uses native-source-lf web/OCR/visual images, retaining
  the existing printing image, model/index mounts, installer and prior approved
  scanner/queue/preview/finish work. Exact 508 web build inputs match source digest
  e087d6bf12cd9474dad70175937af1fd5a8f71282fd34495a016999c913860d0; host login HTTP200.

This fixes #552 and the deterministic-source portion of #560. Failure presentation
remains separate; it does not establish production parity, scanner mechanical
acceptance or recognition accuracy. No production operation or unattended feed.
Private logs live under ignored `.local-data/night-native-*` and the prior
`.local-data/native-source-*` evidence. The overnight handoff records browser
acceptance and final runtime/data conservation.

Final first browser run: 4/4 passed, zero skips (2.4m). Complete/clipped retained originals, desktop1366/phone390 scrolling, three successive ordinary native batches and reload all passed. Observed native completion7.470/8.167/7.093sec on controlled blank fixtures; these timings are workflow evidence only.
