# Evidence ordering in acquisition review

This batch addresses #479 on reference-maintenance PR #478. It reorders existing
suggestions; it adds no model, confidence threshold or automatic confirmation.

## Rules

- Prefer set/collector evidence that agrees with the exact title, then other
  uncontradicted set/collector matches, then title/collector matches.
- Retain contradicted set/collector candidates in the bounded review list. A
  partial OCR title can be wrong: it must not erase otherwise useful identifiers.
  Show those contradictions after uncontradicted candidates in that list.
- Preserve the independent image/SIFT/text alternatives and their evidence.
- Compare readable stamp agreement against unreadable stamp evidence only within
  a printing family: same name, language and printed set/collector. An unrelated
  card or different edition cannot rise just because its stamp agrees.
- Keep unreadable and conflicting stamp results explicit. Existing contradiction
  demotion remains; human corrections and Inventory commit stay authoritative.

The live Scryfall `/sets/mb1` endpoint resolves to `plst` (The List). The stamped
Mystery Booster reprints in this batch use that shared catalog identity. Their
printed original set/collector plus the Planeswalker stamp distinguish them from
unstamped originals; this workflow does not infer the sealed product they came
from. Playtest and other distinct treatments retain their own catalog identities.

## Development evidence

`tools/acquisition-eval/candidate-ordering-results.json` records the scoring and
input hashes. Original files, OCR, image retrieval and native printing
observations remain unchanged. The existing provenance-checked benchmark uses
the archived original index; revised visible-corner labels are scoring inputs
only. Every proposed candidate already has a saved native observation, so this
replay does not invent checks for newly introduced candidates.

- New batch: 124 unique image files, 123 labeled printings and one unresolved
  playtest release. Physical-copy grouping is unknown.
- Before: 111/123 correct first suggestions after printing evidence.
- After: 119/123 correct first suggestions; all 123 remain offered.
- Earlier 68-image regression set: unchanged 55 first / 65 offered.
- Stamp observation remains 7/8 positive and 18/116 negative readable and correct;
  the other 99 are unreadable. Ordering does not improve stamp detection.
- No automatic confirmations. These development replays do not establish
  independent accuracy or new native timing/throughput results.

Focused tests cover conflicting identifiers, partial-title preservation at the
candidate limit, unreadable set text, same-family stamp agreement and unrelated
card ordering. Disposable PostgreSQL/core and live Docker review evidence belong
in the checkpoint and PR after completion.
