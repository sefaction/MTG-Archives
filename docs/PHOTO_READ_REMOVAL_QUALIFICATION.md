# Photo read and removal error preservation

[Issue #832](https://github.com/sefaction/MTG-Archives/issues/832), [draft PR #833](https://github.com/sefaction/MTG-Archives/pull/833); broader storage #305 and release #310 remain open.

## Change and scope

On main 36e27b50, closing a photo file could replace its earlier read or integrity error; closing a removal directory could replace its fsync failure. The two boundaries now attempt close independently and retain both causes in order, the primary cause and safe string code, and lone/falsy identity. Successful reads still return exact bytes. Digest, path, unsafe-file, removal and missing-file retry guards retain their rules.

Source 758f2bc34a9b2a1092002789455bf8fff1ce33af, cumulative 60ff2ed96c887d3558a67b68167612c46d16a9f3 over 61662e0. Only readChecked and removeAcquisitionPhotoBytes change in application source. Normalized AST comparisons verify all surrounding feature and cumulative source remains exact and the two changed functions match. Cumulative review preserves ready PR829's correction helper and PR831's publication writer; neither reviewed PR is revised. The normal test-discovery wrapper includes the new 25 controls in required CI. Final report-only head/CI are recorded on the PR and worker state; application inputs remain 626.

## Evidence and limits

- Old Windows host:13 expected combined/falsy failures,11 passes and one explicit real-Linux descriptor skip. Old actual Linux image:13 expected failures and12 passes, no skips. These execute complete actual functions with real owned files and read descriptors; only the Linux directory handle is adapted on Windows. Real Linux sync/close operations complete before controlled errors are injected. Prior unstarted command/approval-review timeout is preserved separately and is not a failed product test.
- Fixed host:24 passes/one explicit Linux descriptor skip; TypeScript passes. All four actual candidate Linux images pass 53/53 each, no skips:25 new controls plus 28 publication compatibility controls from unchanged PR831. Ordinary integrity/unsafe-file refusal, byte equality, single/falsy/combined errors, exact removal, missing-file retry, Windows skip and neighboring-file controls pass.
- Actual public module in the web image:two read+close, two digest+close and one removal sync+close cases preserve the primary error and ordered causes. Five real faulted descriptors close. Failed reads return no bytes; existing bytes and an independent neighbor remain exact; removal affects only its owned raw/preview pair and retry succeeds. No shared data is used. The existing 2 GiB writer free-space guard remains active; a 3 GiB fixture tmpfs stays within 512 MiB memory/one CPU constraints.
- Built-image PostgreSQL16 migrations/full existing correction verifier pass (migrations: 4425ms; corrections: 5897ms);14 checked fixture classes are empty afterward and the disposable DB/container/volume/network is removed. This is ordinary database compatibility alongside separate file faults, not combined-fault transaction or process-crash recovery.
- All three source-head required checks pass in [39052750569](https://github.com/sefaction/MTG-Archives/actions/runs/39052750569); final report-head checks are recorded separately on the PR.

## Actual cumulative local review

Six intended roles are loaded serially at http://127.0.0.1:13011, with HTTP200/current native readiness. The app build requires the existing scanner installer. All 626 manifest inputs and 332 actual library/script hashes per image are checked. Web manifest 1cbe4dd0a2bcaac79135ed44e43422801187db7ce32d5af0bda82304375726bb; native projected manifest 29feac7f85973556dffc5a09d6b28db678f449c0498dcb8d0a652891ed9908f9. Four pre-existing unused web/native differences remain: app/decks/actions.ts, lib/acquisition-auto-confirm.ts, lib/backup.ts and scripts/verify-acquisition-commit.ts. Full web/native equality is not claimed.

| Roles | Exact loaded image index |
| --- | --- |
| Web / acquisition / catalogue | sha256:647f0ff361f724ed3a4be3c4bdd37fd505a6ccce5d46c2877b5a0f371bf0c4fb |
| acquisition-recognition-worker | sha256:6bfba782c6673450b31630252b08479be20c6cea9659dba2a9cfa332ce9d2139 |
| acquisition-visual-worker | sha256:117f989db9bff07919d5cd193ed23fc1a1c7258ca363e640b8162e24ab91a98b |
| acquisition-printing-worker | sha256:3f2cb87588ba3d794baae6f9e70a6ddd60bf7531ca2cfad43131027292caf151 |

Native source-only layers preserve their base configurations and all base layers. Actual loaded source/image/platform, environment values, mounts, resources and allowed Compose metadata changes are verified; a deliberate memory-setting mutation is rejected.17 peer identities/configuration/lifetimes and primary native event counters are conserved; new review native workers show no OOM events. Prior failed intervals/counters remain evidence.

Current descriptors: OCR f40093b83e51f813f0fd70e64e65d1eae51234a3a9f89c0397ea34fda4391405, visual b6adc9eb114ee39f852a1192acbe089d50be3dd512ec2a51b4ce1c9b30a9f7f1, printing 0ea1c4742a99ed42cd2f62413ae9ad6045f566a9738251e32e4335b780fd0401. Index cf52ce6a642f0111dd5953c09f9d6e2250d339cb062f245efb78924c6caf7905, 1122bytes/2026-10-16T19:30:44.829Z, matches its pre-load marker. This preserves reported current generations/base layers and does not freshly hash every mounted weight byte.

Paired checks conserve 157 originals/904889236bytes, the full 118505/109292-paper catalogue projection, 12 review table/absence markers and review uploads. Owned fixtures are removed; the canonical descriptor changes only six image pointers. No new browser/recognition frame, physical feeding, production change or accuracy claim accompanies this error-reporting repair.

Publication was interrupted after five planned service creations. Saved progress recorded four; actual inspection found visual already on its intended candidate. The first resume guard correctly refused before mutation because the assumed pending baseline did not match. Its failure is preserved. Full planned source/image/configuration/resource/generation checks then verified the existing visual container without restarting it; only printing was recreated. All five earlier loaded lifetimes and17 peers remain conserved. The interruption cause is not established.

Natural ENOSPC, failed-operation database/process interruption, capture-consistent backup/restore, historical755/777/803 causes, sustained recognition, independent accuracy and actual Unraid808 cause/acceptance remain separate. Missing optical originals and original scans17/20 retain their existing NOT RUN/disposition records. 64 decimal GB/owner, 2% controls, private data and human/Inventory authority are unchanged. Author qualification, independent review, individual approval/merge, deployment and user acceptance remain distinct. Exact private evidence is retained in feature .local-data/read-remove-qualification.
