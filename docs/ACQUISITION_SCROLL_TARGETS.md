# Scan navigation target visibility

Issue: https://github.com/sefaction/MTG-Archives/issues/689

Scan cards uses a sticky Batch progress panel whose height changes with viewport width, buttons and alerts. Fixed scroll offsets could place Inventory, saved-card or capture controls behind that panel. The component now measures the actual summary height, observes resizing, and applies that height plus 16 pixels to its local scroll targets. Programmatic jumps measure immediately after the relevant state update; Back to matches waits until Inventory is hidden.

This changes navigation layout only. Review saving, proposal identities, correction policy, scanner acquisition, ownership, capacity and explicit Inventory commits are unchanged.

## Baseline

On the unchanged cumulative local app, an owned 320×900 browser fixture saved three actual reviews and zero Inventory entries/commits. The bulk handoff's Inventory target started at 224px while the sticky panel ended at 296px. The strict visibility assertion failed as expected. Two baseline reports are retained privately, including the counted actual-API result. Owned accounts, correction records and files were cleaned; original source projections and service state were conserved.

## Qualification

The new owned desktop/phone test covers bulk handoff, Back to matches, review/capture links, next awaiting card, keyboard handoff, resizing, a wrapping blocked-draft alert and reload. All pass. It requires destinations to clear the actual panel, remain in the viewport, avoid horizontal overflow, and preserve three actual saved reviews with zero Inventory entries/commits. Controlled GET suggestions isolate layout; actual POST saves are used. These fixtures do not establish recognition accuracy or signed proposal attribution.

The final 16-case cumulative browser group passed with zero failures, skips or retries. It includes the two new navigation cases, bulk proposal attribution, all five interrupted-response recovery cases, bulk deselection, draft protection, fast corrections/private originals, desktop/phone Inventory handoff and desktop/phone No section counted-scanner protocol. The unchanged-app baseline failures and initial two-case passing navigation group remain recorded separately from this final group. The expanded-alert fixture was added after the initial group, and strict geometry polling waits for actual animation-frame jumps without relaxing the visibility bounds.

Measured handoff bounds were target176/summary160px on desktop and target312/summary296px at320px. At375px they were246/230px. With the real wrapping draft alert still visible, the phone target was368px and summary352px. Reload, resizing and capture/review/next-card jumps remained visible. Desktop, phone, capture and expanded-alert screenshots were inspected.

Cumulative867 core tests, type checking, production build with13 checked client manifests, final feature types, and the final required-installer Docker build pass. An initial complex hook-dependency lint warning was removed by naming the same boolean dependency; the final build has no such warning. The implementation head passes all three GitHub checks. Final PR-head checks remain a merge gate and are recorded in the checkpoint/GitHub.

The actual cumulative web image matches595 application inputs. All three existing native workers match their308 shared inputs; native services were not restarted. Only web was recreated, with existing mounts, environment and limits conserved. All13 ordinary services are running and the app is healthy. Nine completed owned fixture namespaces and their correction/account records are absent; all seven original source-table projections match the fresh baseline. Fresh SHA-256 reads of all1092 original files (2,832,075,218 bytes) match both stored identities and the before baseline after browser cleanup.

The local review stack includes merged main plus separately unapproved684/687/688 and this independent main-based PR690. No physical scanner feed, independent recognition accuracy or production acceptance is claimed. Issue689 remains open until PR690 receives its own individual approval and merges; broader506/463/307 remain open. Existing64 decimal GB per owner and2% controls remain, and verifier/cohort decisions are unanswered.
