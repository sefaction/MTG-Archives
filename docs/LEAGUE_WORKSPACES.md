# League task workspaces

Issues #272 and #319 reorganize the independent Commander League context. League authority, public-printing scope, scoring and permanent game/deck snapshots remain unchanged.

| Task | Home |
| --- | --- |
| Find or create a yearly league | `/league`; member leagues first, creation disclosure opens for a new member or validation error |
| Season summary and standings | `/league/:id`; monthly counts link to scoped game history |
| Record a completed game | `?view=record`, organizer only; explicit permanent deck-freeze wording and existing elimination/draw validation |
| Browse completed games | `?view=history`, with round filter and bounded read-only history |
| Players and linked public locations | `?view=manage`; members can view, only League organizers can modify |
| Submitted deck library | `/league/:id/decks`; searchable by player/name and month, bounded results, editable/frozen status and creation disclosure |
| Deck structure, card usage or win rates | `/league/:id/stats`; task views preserve selected player/month scope |

Large creation pickers are searchable and bounded. Checked choices remain submitted even when search hides them; the creator remains an automatic member. Management selectors retain their native keyboard controls and existing server authorization. Form errors return to the task that owns the action. A successful game returns to history with stale validation feedback removed.

Unsaved form entries remain local to their current page; navigating away does not save or record them. No new season-editing authority, game-history editing, physical inventory commitments, or playtest changes are introduced. Library/history regions bound the rendered workspace, not database query size. Statistics still use immutable match snapshots, exclude sideboards/maybeboards, and preserve the existing basic-land distinctions.

## Validation

The populated baseline audit exercised the entire two-member season, linked printing scope, submitted decks, rejected/corrected game entry, win/draw games, frozen snapshots and conservation before UI edits. It reproduced a 390px season overflow (#319). Baseline screenshots also covered deck library/detail and every statistics section.

The expanded `tests/ui/league-lifecycle.spec.ts` keeps all prior invariants and adds task/role navigation, searched-away selection persistence, frozen library state, deck/history filters, player/month context between statistics views, all task views at 1366/390/320px, themes and enlarged text. Exact passes, failures, application/image IDs and limits belong in WORK_CHECKPOINT.md and LOCAL_REVIEW_BUILD.md. No production deployment or merge is authorized by these checks.
