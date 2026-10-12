# Recognition fixture cleanup after early errors

Scoped follow-up to [#692](https://github.com/sefaction/MTG-Archives/issues/692): printing, footer-identifiers and scanner-framing browser fixtures. The completed stamped and intake subsets in PRs #733/#737 and difficult-phone qualification in #735 are separate.

All three unchanged actual finally blocks leave their disposable Player, User, location, correction account and private directory when the initial feedback sweep throws. PostgreSQL probes reproduce each failure and recover only those exact owners afterward. Corrected actual-block probes retain the injected error and remove all five owned namespaces. These are controlled failure-boundary probes rather than passing complete native browser workflows.

The correction collects cleanup errors, attempts the existing cleanup actions independently and always attempts the final feedback sweep. The printing fixture also attempts both optional diagnostic reports independently, so a report write failure cannot prevent its database teardown. It reports all causes through an aggregate error. Original workflow bodies, all 129 assertion calls, legacy database/file cleanup operations and deadlines remain unchanged against main.

Seventeen actual-block controls cover each cleanup action, multiple errors and normal completion. Types and full native browser qualification are tracked on the PR. Nine distinct recorded source originals match their hashes: three printing originals, four footer originals and two framing originals. The printing check retains its fourth repeated source-mode case. No substitute image or physical scanner operation is used.

All three original native/browser workflows pass with no skipped cases or retries: footer 174.511 seconds, framing 102.831 seconds and printing 300.547 seconds. Desktop and phone review assertions, ordinary worker admission and original mode/deadline guards are retained. Inventory receives no automatic confirmation.

All four actual fixture owners (including the failed setup) have zero rows across 18 source/auth/Inventory/feedback models and no private correction directory. All 16 fresh source/substantive-feedback projections, 16 ordinary service identities and the current 598 source inputs are conserved. A fresh actual-byte check preserves 1,094 ready originals / 2,845,198,201 bytes and the existing correction original with matching SHA/size identities. All 17 controls and typecheck pass. All three required source-head CI checks passed; exact final evidence-head CI is checked separately on PR #738.

Test-only changes need no application or native image rebuild. The 64 decimal GB per-owner library limit, 2% controls and explicit Inventory authority remain unchanged. Reused development inputs do not establish independent recognition accuracy, hardware acceptance or 100/300-input throughput. Broader #692/#463 remain open. Private source images, namespaces and raw results stay ignored locally.


## Retained setup failure

The initial printing invocation used the containing private corpus directory rather than its originals subfolder. It fails with ENOENT before reading a scan; that result and its artifacts are retained and are not a passing workflow claim. The original footer and framing checks pass in that invocation. Only printing is rerun with the verified originals root, preserving its full four-case body and existing deadlines. This setup correction changes no source or runtime policy.

Safe qualification evidence: [recognition-fixture-cleanup-qualification.json](../tools/acquisition-eval/recognition-fixture-cleanup-qualification.json). Cumulative review includes #733/#735/#737/#738 with unchanged phone-preparation735 web/native images. Private original pixels, authentication and raw results remain ignored locally.
