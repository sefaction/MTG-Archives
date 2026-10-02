# Import workflow acceptance ledger

The active goal covers scanner connection, batch start/continuation, image intake,
processing, review/correction, destinations and explicit Inventory commit. Prioritize
fi-7160 batch work using retained scans and owned local fixtures. Original bytes,
saved user reviews and Inventory are authoritative. No unattended physical scanning,
production changes, merge or production deployment without individual approval.

| Requirement | Current evidence | Remaining work |
|---|---|---|
| Connection and reconnect | Merged helper/install/readiness/recovery work; docs/SCANNER_USER_WORKFLOW_AUDIT.md | Physical reconnect/driver behavior remains hands-on; audit software recovery independently. |
| Start and successive batches | Merged durable Start identity, empty rejection retirement and remembered setup | #565: missing production catalog service was restored by the operator; batch24 resumed. Complete all88/refresh/next-production-batch acceptance remains open. Merged queue546/567 are separate. |
| Upload/retry/refresh | Existing owned upload/library/reconnect checks | Repeat across larger scanner-style batches; verify generations, capacity and byte preservation. |
| Processing and recovery | Merged first-result/owner admission, obsolete candidate retirement and printing reuse | #566 is closed after merged567 exact replacement guards. Native source portability569 is unmerged/locally qualified; terminal failure/manual recovery570 is being validated independently. Actual restart/lease acceptance must stay evidence-based. |
| Stable review | Merged #563; repeated Simple/Advanced scrolling, full-pixel retention, deferred load/retry and draft correction checks | Larger-batch polling, filter and refresh interaction; keep saved/original comparison stable. |
| Fast corrections | Existing Save and next, direct name search, uncertainty/stamp presentation | #564 is closed after merged568 direct finish controls. Cumulative desktop/phone correction, draft, saved-review and explicit fixture commit checks passed; preserve these protections. |
| Destination and explicit commit | Existing shared receipt/capacity/concurrency guards and Inventory handoff | Audit selection loss/repeated entry, final review-to-Inventory clarity, larger/repeated commit recovery; no implicit stock changes. |
| Efficient recognition | Approved recognition audit #551, reuse #556 | Implement qualified identifier/printing-family routing with broad difficult-read fallback after reliability batches; do not treat corpus replay as independent accuracy proof. |

Keep this ledger evidence-based. Each fix has its own issue, PR, checks and local
cumulative build provenance. A narrow regression or green CI does not complete the
full scanner-to-Inventory goal. Future hands-on checklist must cover install/reconnect,
three successive batches, uncertain/stamped corrections, capacity/destination and
explicit commit/reload without duplicate stock.
