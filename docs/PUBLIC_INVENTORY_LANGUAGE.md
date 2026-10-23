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
record values are also normalized by the query builder. Public suggestions now
preserve every repeated Language URL value before parsing, matching page/list
semantics. Other repeated query parameters retain their existing behavior.

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

## Initial comma-separated qualification

Thirty-five focused language/Inventory/public checks and final TypeScript
typechecking pass. The actual regression passes ten language/owner cases through
both list and suggestions, anonymous Private rejection, and three real form
applications (French, both languages, empty) at each of 1366px and 320px. The
printing shared between EN and FR stays correctly scoped through actual
physical-language metadata. All 84 table fingerprints match after exact cleanup.

The first full browser attempt passed the API controls and first French form
application, then toggled an already-open persisted desktop panel closed. The
corrected test respects its existing open state and waits for document navigation;
the complete corrected test passes twice, including on the final image. API DTO
checks use existing `cardName` and wishlist-target language fields rather than
inventing top-level fields. These are harness corrections, not product repairs.
Original failures remain in ignored local evidence.

The standard production build passes compile, lint/types, static generation and
client manifests. The local cumulative review at `ab768dd0` includes #902, #909,
#912 and this language repair; no merge is implied. Final image
`sha256:81ba039f513fa75566f7ea9a6c360331289f17682b66d376786bee7950f9baed`
binds all 1,229 declared source inputs, digest
`dbfac3414907eb4f8b5ef27ac9bbed9972aa4f9285165f6b0c1dbbd60b734794`.
A first manifest-check invocation used the wrong working directory and failed to
find its input; the corrected cumulative-directory check matches every input.
No build input changed between final build and that check.

The final image is healthy with zero restarts/no OOM kill at
http://127.0.0.1:23001, using the explicit desktop Compose plus
`compose.issue913.yml`. All 84 original snapshot tables match before build and
after final load/browser checks. Existing volumes and issue901 rollback image
are retained; no fixture or temporary session remains. The phone screenshot was
visually inspected. This is local software qualification, not physical scanner
or production acceptance.

The first published head passes all seven hosted checks in Verify39973694488.
The PR records the exact final head and its separate required hosted results;
do not infer those from the earlier run. Ready status requires those final-head
checks to pass. Keep #913 open until its individually approved resolving merge.
Deployment and independent user acceptance remain separate.

## Repeated URL values — final local qualification

A follow-up control found an additional defect at the initially ready head:
`language=EN&language=FR` returns both languages in the existing page/list parser,
but Public suggestions retained only FR because Object.fromEntries discarded
earlier occurrences. This negative preserved all 84 original table fingerprints.
The prior ten API cases did not cover repeated query keys. PR #914 was returned
to draft while this remaining consistency gap was repaired.

The existing shared Public suggestion branch now passes all Language values to
the same parser. Private parsing, authentication, middleware, namespace and every
other scope key are unchanged. The actual regression now passes twelve paired
list/suggestion language/owner cases, including repeated EN/FR and trailing-empty
values, plus the original private/zero-stock sentinels, Private401 and six real
desktop/phone form applications. The complete run passes in 13.4 seconds and
restores all 84 fingerprints. Focused35 checks and full typecheck pass.

Two standard local build attempts terminated while Docker Hub base-image metadata
authorization timed out, before compilation. Their failure logs remain. The
successful local recipe uses the already-qualified image81ba039f as a local base,
copies the exact cumulative source, regenerates the client/manifest, and runs the
full production compile/lint/type/static/client checks with locked dependencies.
The separate four-line local recipe SHA256 is
`be5f66d2ca0e18d2c35f1eb6146860aab81c5a3d23af21a1c567eda3d0caffab`.
This reuse avoids registry resolution; it is not a claim that the local image was
built by the canonical multistage Dockerfile. Canonical final-head CI remains a
separate mandatory gate recorded on the PR.

Cumulative source/test integration `2c13666bc898c59cbd6da59fc26c6218b1e5146a`
includes #902/#909/#912/#914. Image
`sha256:031a7a0be5d0943101f58efd89e833f94e2ab0aab3bf4b005a9a9f11dea431cd`
matches all 1,229 declared source inputs, digest
`af5476b3b6b110b74cd5712254d2c4908ad8dd9dfed11305cc2ff2f5089a7f4d`.
It is loaded in the same isolated desktop test project at localhost23001.
The earlier image/CI results above retain their original, narrower input scope.
Only the current PR head's terminal CI results can establish final readiness.
