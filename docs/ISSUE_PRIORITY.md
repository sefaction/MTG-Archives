# Active issue order

All previously held issues were activated on 2026-09-23 at the user's request. GitHub remains the live status authority. Open PR #315 is the acquisition planning baseline; it remains unmerged until separately approved. No production deployment or automatic PR merge is authorized.

| Order | Issues | Reason and dependency |
| --- | --- | --- |
| 1 | #327 | Stop Pricing history reads from blocking the site; measure the present bottleneck. |
| 2 | #332, #333, #334, #331 | Audit private/Public/League parity, then update public inventory and keep a cross-surface regression gate. These can share one cumulative local Docker verification with #327. |
| 3 | #328, #329, #335, #330 | Durable daily and long-range pricing summaries, owned-card movers, opt-in notifications, then verified archive/retention. #326 tracks the outcome. |
| 4 | #263, #264, #265, #268, #274, #262 | Complete outstanding UI foundation, Inventory and Decks acceptance gates using the new parity work. Avoid additional Playtest implementation unless the user changes that direction. |
| 5 | #303 through #310, then #302 | Image-first Card Acquisition session, image pipeline, review, transactional commit and release acceptance. Use planning PR #315 as the design reference. |
| 6 | #311, #312, #313, #314 | Windows scanner agent and virtual source, then physical fi-6130Z and optional scanner-family qualification. Physical #313 waits for hardware; the user does not yet have that scanner. |

Within each row, implement in dependency order and open one reviewable PR per coherent issue batch. Several completed branches may be combined into one local Docker build before browser verification. Leave issues open until their PRs merge, and never infer merge approval from a green check or local review.
