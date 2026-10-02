# Import workflow acceptance ledger

The active goal covers scanner connection, batch start/continuation, image intake,
processing, review/correction, destinations and explicit Inventory commit. Prioritize
fi-7160 batch work using retained scans and owned local fixtures. Original bytes,
saved user reviews and Inventory are authoritative. No unattended physical scanning,
production changes, merge or production deployment without individual approval.

| Requirement | Current evidence | Remaining work |
|---|---|---|
| Connection and reconnect | Merged helper/install/readiness/recovery work; docs/SCANNER_USER_WORKFLOW_AUDIT.md | Physical reconnect/driver behavior remains hands-on; audit software recovery independently. |
| Start and successive batches | Merged durable Start identity, empty rejection retirement and remembered setup | #565 reports a later production batch apparently not receiving recognition; establish queue/runtime cause locally and retain production qualification gap. |
| Upload/retry/refresh | Existing owned upload/library/reconnect checks | Repeat across larger scanner-style batches; verify generations, capacity and byte preservation. |
| Processing and recovery | Merged first-result/owner admission, obsolete candidate retirement and printing reuse | #566:1164 local queued old-model attempts already have newer current-model replacements; guard generation retirement. Audit failed-state messages/retry and native-source reproducibility (#552/#560). |
| Stable review | Merged #563; repeated Simple/Advanced scrolling, full-pixel retention, deferred load/retry and draft correction checks | Larger-batch polling, filter and refresh interaction; keep saved/original comparison stable. |
| Fast corrections | Existing Save and next, direct name search, uncertainty/stamp presentation | #564 explicitly requests direct Foil/Nonfoil buttons. Verify valid finishes, dirty draft preservation, reviewed/committed protection and bulk-safe interaction. |
| Destination and explicit commit | Existing shared receipt/capacity/concurrency guards and Inventory handoff | Audit selection loss/repeated entry, final review-to-Inventory clarity, larger/repeated commit recovery; no implicit stock changes. |
| Efficient recognition | Approved recognition audit #551, reuse #556 | Implement qualified identifier/printing-family routing with broad difficult-read fallback after reliability batches; do not treat corpus replay as independent accuracy proof. |

Keep this ledger evidence-based. Each fix has its own issue, PR, checks and local
cumulative build provenance. A narrow regression or green CI does not complete the
full scanner-to-Inventory goal. Future hands-on checklist must cover install/reconnect,
three successive batches, uncertain/stamped corrections, capacity/destination and
explicit commit/reload without duplicate stock.
