# Card Hunt

Issue #1008: make a list of the storage boxes and sections needed to pull cards.
Brian confirmed storage-only candidates and, on November 6, preferences first
with a choice to optimize. This is a read-only plan, not a reservation, inventory
move, deck edit or saved hunt.

## Using a hunt

Open Card Hunt in navigation, or use Card Hunt in a deck's tools. Choose a personal
deck or paste a list using the existing decklist syntax. Maybeboard is excluded
unless selected. Copies already committed to the source deck reduce what remains
to pull, consuming each committed quantity once across duplicate requests.

For a deck hunt, turn on **Ignore basic lands** to leave known basics (including
snow basics) out of the pull and shortage lists. The summary shows how many
copies were skipped. Nonbasic lands and cards without a known type stay in the
hunt. The option starts off and does not change the deck or its commitments.

The default **My preferences first** prioritizes an explicit finish preference,
then the requested printing. Any finish is the default; the deck/list supplies the
printing preference. A pasted `*F*` annotation overrides the global finish for that
line. Available alternate printings/finishes can fill gaps and are visibly marked.
Foil and etched are distinct choices. Suggestions use available owned storage,
never an online catalogue lookup or another deck's copies.

**Optimize boxes** instead groups available copies to cover more outstanding
requests per location; preferences break ties. Existing selected boxes are reused
when possible. This deterministic greedy plan is not an exact minimum-box solver
or physical walking route. Grouping always uses location identity, not merely its
name, and retains sections, printing, finish, language, condition and quantities.
Unassigned copies are shown explicitly. Preference compromises are marked.

Each stack has one shared remaining quantity across the entire hunt. Modern
active trade lines and legacy line-less trades reduce availability using existing
reservation semantics. Inactive/system deck locations, foreign inventory and
foreign-owned locations are excluded. Other-deck copies never supply availability,
suggestions or shortage fallback. Personal storage is not a substitute for the
separate League pool; League decks remain in their existing workflow.

## Boundaries

Only the signed-in user's inventory and own personal decks participate, including
in administrator mode. Owner IDs supplied by clients are ignored. The endpoint
uses a repeatable-read snapshot and private/no-store responses. A plan is not a
promise of future availability; rebuild it when inventory or trades change.

The request body is bounded at128KB, text at100,000characters and500card lines.
Individual quantities must be whole numbers from1to1,000,000. This bounds one
planning request, not collection size. Results page boxes/lines and progressively
show large box contents. Shortages and parsing notes remain visible. Pull checkboxes
are temporary page reminders and are not persisted or shared across pagination.

## Qualification

Focused planner controls cover preferences versus grouping, the three-cards/one-box
case, duplicate demand, shared stock, committed quantities, reservations, foreign
and inactive storage, alternate printings and explicit shortages. A representative
150,000-copy/3,000-stack/300-location planner case conserves all quantities; this
is synthetic planner evidence, not a database/browser capacity benchmark.

`scripts/verify-card-hunt.ts` uses the real service and disposable PostgreSQL,
checking modern/legacy reservations, source-deck subtraction, duplicate lines,
owner isolation and refusals. Every public table's full-row fingerprint must match
both after read-only requests and after fixture rollback. It runs in the existing
PostgreSQL import-integrity CI job. Desktop/phone author review, production build,
exact-head CI and remaining limits are recorded in the PR; their completion is not
implied by this design document. Merge, installation and user acceptance remain
separate.
