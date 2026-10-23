# Public Inventory language filter (#913)

Brian confirmed on October 23, 2026 in desktop chat
`01a1692e-ab36-7d32-8cd9-a4d679df7680` that the Language filter must constrain both
Public Inventory results and scoped search suggestions, with desktop/phone and
privacy checks. The original issue's provenance is not reclassified.

The public query already parses structured languages but omitted their inventory
predicate. The repair applies the existing normalized list to physical inventory
language, preserving public visibility, ownership and every other predicate.
Absent/empty selections remain unrestricted; unknown codes remain literal
uppercase selections, consistent with the shared parser and Private Inventory.
The form's existing comma-separated syntax supports multiple languages. Repeated
record values are also normalized by the query builder; this change does not
rewrite URL adapters or redefine other repeated query parameters.

## Regression evidence

On main `51f810c3`, five original-query language assertions fail and the no-filter
control passes. The actual old production image returns six exact groups when
French should return three, using an owned EN/FR fixture with one card represented
in both languages. Its fixture cleanup reproduces all existing table fingerprints.
An earlier snapshot-harness quoting failure occurred before creating fixtures and
is retained separately as setup evidence. No product assertion was relaxed.

The focused tests exercise the actual query builder, language normalization,
empty/unknown/multiple selections, preserved predicates and scoped suggestions.
The real browser test uses public/private owners and a private location, mixed
physical languages, and zero-quantity inventory. It checks list/suggestion
agreement, owner scope, anonymous Private rejection, real filter application and
chips on desktop and phone, followed by exact owned cleanup and full-table
fingerprints. Its alternate local target requires explicit localhost port,
container and matching Compose-project settings; ordinary runs are opt-in.

Local anonymous suggestion qualification includes the separately reviewed #912
route repair. The language PR remains based on main and contains no routing,
authentication, schema, private-filter or writer change. #912 is a local
qualification dependency, not a merged delivery claim.

## Current qualification

Thirty-five focused language/Inventory/public checks and TypeScript typechecking
pass. Source-bound cumulative production build, full real browser/API matrix and
required final-head hosted checks are pending. Keep the PR draft until these
finish. Keep #913 open until its individually approved resolving merge. Production
deployment and independent user acceptance remain separate.
