# Whole-deck trade design — decision checkpoint for #807

Status: draft; source reviewed at main b810f06a. No deck-transfer implementation or migration. Individual-card gifts are a separate batch in PR #880. This document preserves the confirmed requirements and identifies the product boundary that needs Brian's input.

## Confirmed behavior

Transfer the existing Deck identity and complete list, including list-only Maybeboard, to the recipient on the same installation. Transfer exactly its eligible committed physical copies; do not fill missing cards, create assumed basic lands, copy the deck instead of transferring it, or include uncommitted stock. Any physical Maybeboard commitments block the trade until the sender explicitly returns them to storage. Gifts may have an empty return side; both sides empty remain invalid. Acceptance, counters, decline, cancellation and both physical confirmations retain their existing authority. No ownership changes before completion.

## Confirmed follow-up decisions — October 21, 2026

Brian explicitly confirmed in this chat:

- An offer supports multiple whole decks and individual cards on either side. A single-deck-only first version is not the agreed scope. Each deck remains indivisible.
- Every League-linked deck is excluded from transfer, including unsubmitted decks. No League membership or submission reassignment is introduced.

The remaining counter, recipient organization/visibility, ambiguous Maybeboard allocation and received-storage choices below still require explicit resolution. These decisions supersede the corresponding questions and narrower suggested first-delivery boundary in the preserved design history below; they do not authorize merge or deployment.
## Source findings and consequences

- `prisma/schema.prisma`: Deck ownership is `ownerUserId`; physical ownership is InventoryItem.currentOwnerId, linked through User.playerId. InventoryLocation has a unique deckId and its own ownerPlayerId. Changing only Deck.ownerUserId would leave physical storage/ownership inconsistent.
- `lib/deck-inventory.ts`: committed stock is positive InventoryItem quantity in the system deck location, aggregated by cardId. It has no per-DeckCard commitment link. List rows are independently sectioned DeckCard entries.
- `app/decks/actions.ts`, updateDeckCard: moving a printing to Maybeboard explicitly permits keeping physical commitments. That state must be blocked for trading. A printing can occur in more than one list section; a per-card aggregate alone cannot identify which copies belong to Maybeboard.
- `lib/deck-management-policy.ts`: submitted Commander League decks are locked, and League administrators can manage some decks. Management authority is not automatically ownership-transfer authority. League membership, frozen submissions and snapshots cannot silently move to another person.
- Deck.folderId and Deck.tags reference sender-owned organization. Keeping those links after transfer could retain foreign private organization or violate owner-based assumptions. INHERIT visibility depends on the owner; ownership change can change effective access.
- `app/trades/actions.ts`: ordinary trade proposal rejects DECK inventory locations. Transfer receipts are separate lots in an explicit normal destination. A deck bundle requires a distinct validated path; removing the DECK exclusion globally would permit partial bundle transfers and invalid commitments.
- `lib/trade-lines.ts`: ordinary offers allow 50 unique physical lots per side. A 100-card deck may exceed this with printing/finish/condition lots. A deck bundle must not silently truncate or merely raise ordinary offer limits.

## Decisions required before publishing a deck trade flow

1. Offer composition: may one offer include a deck plus individual cards, multiple decks, or a deck on both sides? A single indivisible deck gift is confirmed, but this does not decide the rest. Suggested first delivery: one indivisible deck per offer, with a card-only or empty return side, if Brian approves that boundary.
2. Counters: should a counter preserve a bundle whole, replace it whole, or remove it? Partial transfer cannot satisfy the confirmed as-is requirement. A changed bundle always needs renewed review and confirmation.
3. Organization and visibility: should the recipient choose folder/tags and explicitly confirm effective visibility? Suggested boundary: no sender-owned folder/tag links cross the ownership boundary; do not silently choose a public default or discard organization without an agreed policy.
4. League decks: retain current restrictions and block submitted/frozen decks. Is transfer of an unsubmitted League-linked deck allowed at all? No implicit League membership/snapshot reassignment.
5. Ambiguous Maybeboard commitments: when the same printing exists in both Maybeboard and an eligible section, is any positive committed quantity for that printing blocking, or must per-section physical allocation be introduced? Do not infer allocation from quantities or silently remove the Maybeboard row.
6. Received storage: how should the explicit trade destination interact with the system deck location that keeps the transferred cards committed? Options need a deliberate product decision; ordinary trade receipt into a normal location alone would lose valid deck commitments.

No response is needed during unattended work. Stop the dependent product mutations at these decisions and continue independent queue work.

## Proposed implementation after decisions

Use a first-class bundle reference and immutable reviewed snapshot tied to the existing deck ID, list/organization/visibility revision, physical lot IDs/quantities/attributes and relevant restrictions. A revision token must cover all of those values, not only Deck.updatedAt; physical moves may not update that timestamp. Display list-only gaps and exact committed quantities distinctly. Do not flatten a bundle into editable ordinary lines.

Reserve a deck once across active offers, plus its exact physical stock, using transactional exclusion. Revalidate ownership, restrictions, list/stock snapshot and Maybeboard conditions at proposal, counter, acceptance and completion. Resolve any changed contents through renewed review; never silently substitute a later list. Existing deck edits, stock moves and new commitments must participate in the same locking/reservation policy. Locking only the trade cannot fence independent deck and inventory writers.

Complete ownership, physical lot transfer, system location ownership, valid commitments, organization disposition, history/audit and trade completion in one transaction with an exactly-once completion fence. Preserve opener, pull/round provenance, printing, finish, condition, language and notes. Keep a historical bundle snapshot so completed trade history survives later deck edits. Cancellation and decline release reservations without moving any deck or stock. Fresh authorization is necessary even for administrators.

## Independent acceptance plan

- Real PostgreSQL: 100-card deck with more than 50 physical lots; partial physical coverage and assumed basic lands; list-only Maybeboard retained; physical Maybeboard blocked; same-printing multi-section ambiguity follows the chosen policy.
- Gift and two-sided trade: recipient accepts, each party explicitly confirms; first confirmation transfers nothing; second transfers the same existing deck and exactly reviewed lots once. Retry, duplicate final confirmation and admin overlap do not duplicate transfer.
- Concurrent edits, stock relocation, reservations, duplicate bundle offers and ownership changes invalidate stale review. Completion rollback after the first lot leaves deck, locations, list, lots, quantities and audits unchanged.
- Cancellation, decline and counter replacement release only their own reservations. Preserve unrelated reservations and resident inventory; conserve all physical copies and provenance across source/receipt audit records.
- Deny nonparticipants, another owner's deck and forbidden League/frozen cases. Verify effective private/public visibility and absence of sender-owned organization references after transfer.
- Desktop and 320px phone: start from owned deck, review complete bundle and missing coverage, understand blockers, select agreed destination/organization, accept/confirm, then find the existing deck in recipient library and absent from sender library.
- Load cumulative local Docker, record all included PRs/commits, and run real browser and PostgreSQL checks. Separate authored checks, independent review, CI, merge, installation and user acceptance. Keep #807 open until the whole confirmed scope is delivered or explicitly transferred with acceptance criteria.
