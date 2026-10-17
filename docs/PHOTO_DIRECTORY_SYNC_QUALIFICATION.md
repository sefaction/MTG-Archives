# Photo publication directory error preservation

Issue [#830](https://github.com/sefaction/MTG-Archives/issues/830), draft [PR #831](https://github.com/sefaction/MTG-Archives/pull/831), related storage [#305](https://github.com/sefaction/MTG-Archives/issues/305) and release [#310](https://github.com/sefaction/MTG-Archives/issues/310).

## Scope

On main36e27b50, an original-photo directory fsync error was replaced by a subsequent directory close error. Raw and preview publication now retain both causes, followed by any temporary unlink error, with the original cause and first safe string code. Lone and falsy failures retain identity. The published immutable bytes, existing-file retry, neighboring files, Windows behavior and storage guards remain unchanged.

Source 43ed93c993ad1178af7c41957375062e42275c43; cumulative 2f1a29d821a752a92fc980abac9376340e8876ca adds that repair over53cdf618, preserving the separate unmerged correction-helper PR829. Only writeAcquisitionPhotoBytes changes in the application source; normalized committed source and all surrounding functions/imports are checked. The report-only final revision and exact-head CI are recorded on the PR; report changes do not alter the626 application inputs.

## Evidence

- Current old Linux image:28 complete actual-function tests,21pass/7expected failures, including raw/preview sync+close, three ordered causes and falsy primary values. Real directory sync and close occur before controlled error injection. Old host negative also fails7; this establishes diagnostic cause loss, not natural disk exhaustion.
- Fixed Windows host:27pass/one explicit real-Linux descriptor skip. Only the Linux directory handle is adapted on Windows; actual file writes, immutable links, cleanup and retry remain real. TypeScript passes.
- Four actual candidate Linux images:28/28 each, no skips. Complete actual functions are extracted from each image's verified source. Real directory descriptors, raw/preview combined faults, ordered sync/close/unlink, lone/falsy errors, ordinary publication, Windows skip path, existing-file retry and neighboring bytes pass.
- Actual public writeAcquisitionPhotoBytes/readAcquisitionPhotoBytes module in the web image: raw and preview compound faults retain ENOSPC then EIO; both real directory handles close, temporary files are removed, published bytes remain exact, immutable retry succeeds and an independent neighboring original remains intact. The2GiB free-space guard is retained; fixture tmpfs allows3GiB while512MiB memory remains bounded.
- Built-image PostgreSQL16 migrations and the existing full correction verifier pass (migrations:6882ms, corrections:7229ms). All14 checked fixture classes are empty afterward; owned database container/volume/network are removed. This verifies ordinary database compatibility alongside separate file faults; combined-fault database rollback/process-crash recovery is not claimed.
- Required source-head CI: all three checks in [38998628155](https://github.com/sefaction/MTG-Archives/actions/runs/38998628155); exact final report-head checks are recorded separately on the PR and worker state.

## Cumulative local review

Six intended roles are loaded serially at http://127.0.0.1:13011. HTTP200 and actual current native readiness descriptors pass. The application build requires the existing scanner installer. Each role's626 manifest inputs and332 actual library/script file hashes are checked. Web manifest 996f2858bc70fb366b5c865632ba6167704a4c31db4dda4015e43d803abfda4f; native projected manifest 14049827e78a42f44713af5705dfa5c999cd398511e95275979651b23cd8b809. Four pre-existing unused web/native source differences remain: app/decks/actions.ts, lib/acquisition-auto-confirm.ts, lib/backup.ts and scripts/verify-acquisition-commit.ts. Full web/native source equality is not claimed.

| Roles | Exact loaded image index |
| --- | --- |
| Web / acquisition / catalogue | sha256:2379c8a0dd5ba3ddbab01721b195779bcd66ebb58205537d657539e301cff641 |
| acquisition-recognition-worker | sha256:3951582649117bf2a71463dc3394f73302ef5a1fc6512964ec12423e31eae67c |
| acquisition-visual-worker | sha256:22c8bffcd76d0dc3817e98762af4bbbb731c8c511f4608be2915f3c944b66b4c |
| acquisition-printing-worker | sha256:cc58d4bb41e911f97c92b464a445f1f5bbe778e1e22a6d356a8738742ff81a40 |

Native source-only layers preserve all base image layers and configuration. Actual image/platform/source, environment values, mounts, resource limits and allowed Compose metadata changes are checked; a deliberate memory-setting mutation is rejected by the conservation guard.17 peer identities/configuration/lifetimes and primary native event counters remain exact. Newly recreated review native workers report no OOM events; earlier failure intervals/counters remain in retained evidence.

Current descriptors: OCR f40093b83e51f813f0fd70e64e65d1eae51234a3a9f89c0397ea34fda4391405; visual b6adc9eb114ee39f852a1192acbe089d50be3dd512ec2a51b4ce1c9b30a9f7f1; printing 0ea1c4742a99ed42cd2f62413ae9ad6045f566a9738251e32e4335b780fd0401. Index cf52ce6a642f0111dd5953c09f9d6e2250d339cb062f245efb78924c6caf7905, 1122bytes, 2026-10-16T19:30:44.829Z, matches its pre-publication marker. These checks preserve reported current generations and base layers; they do not freshly hash every mounted weight byte.

Paired fingerprints conserve157 originals/904889236bytes, the118505-card/109292-paper catalogue projection,12 review table/absence markers and review upload manifests. All private fixtures are removed. The canonical descriptor changes only six image pointers. No recognition/browser frame, independent accuracy, new physical feeding or production operation was run for this error-reporting boundary.

## Retained failures and limits

The first narrow source-edit command rejected a CRLF checkout match before mutation; the following unchanged-source host test still failed as expected. Normalizing line endings allowed the intended edit; its later passing controls remain distinct from that setup failure and the saved old-source negatives. A read-only helper inspection used a wrong relative path and failed without affecting the build/checkpoint. No acceptance assertion or product guard was relaxed.

Natural ENOSPC, original-photo read/close and removal boundaries, failed-operation database/process interruption, capture-consistent backup/restore, historical755/777/803 causes, sustained recognition, independent accuracy and actual Unraid808 cause/deployment remain separate. Missing optical originals and original scans17/20 retain their existing NOT RUN/disposition records.64 decimal GB/owner,2% random controls, private originals and human/Inventory authority are unchanged. Author qualification, independent review, individual merge approval, deployment and user acceptance remain separate. Private evidence is retained in feature .local-data/photo-directory-qualification.
