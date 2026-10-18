# OCR title conflict ordering

Related to #837 and parents #463/#307. This is partial delivery; weak contained names, unlocalized face/body hints and broader independent recognition acceptance remain open.

The resolver already records TITLE_CONTRADICTION when an identifier candidate conflicts with a supported title. Previously equal identifier tiers used distance and local Card ID next, so a contradictory candidate could lead. The comparator now demotes known title contradictions within each existing identifier tier. Identifier retrieval/precedence, title matching, raw observations, alternatives, conflict/status and automatic-acceptance predicates remain unchanged. Text and catalog interpretation versions advance together; no bulk historical replay or repair is performed.

## Source controls

Base main: 8a33600c94f2ad795cc2bfc988dee9a8fc570682. Eight new synthetic controls have 3 passes and 5 failures on the old source and 8 passes after the comparator change. Four numeric-conflict cases cover primary competing numbers, supplemental explicit numbers, an extra OCR title token and a truncated number. Each tests reversed input order, swapped IDs, direct/oriented paths, retained conflict/alternatives and display truncation. Additional controls preserve same-name/List uncertainty, absent/typo/ambiguous titles, short/Unicode/face titles, identifier precedence and unlocalized hints. These are synthetic software controls, not native OCR, independently verified historic labels or an accuracy estimate.

The full acquisition unit suite passed 492/492 before the catalog-version increment; final exact-source qualification is recorded below as it completes. No thresholds, native models, image-combination policy, physical count, finish, condition, human review or final Inventory authority are changed.

## Qualification still pending

Exact-final CI, actual Linux image source/tests, cumulative Docker publication and paired conservation are pending. Keep the PR draft until author qualification completes. No production deployment or historical data repair is authorized by this change.
