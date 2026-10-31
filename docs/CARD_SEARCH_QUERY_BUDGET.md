# Card-search transaction budget — existing #846

Name-only deck resolution previously opened up to 75 independent card-cache transactions in parallel; manual search opened up to 20; the deck printing picker started up to its requested result limit. Each upsert owns an interactive Prisma transaction. These paths can compete for shared PostgreSQL slots independently of the final League gate repaired in #986. This is a separate bounded repair, not attribution of #808 or a complete production pool/leak diagnosis.

All three loops now await one cache write at a time. Existing result limits, returned manual choices, cheapest-printing ordering, exact matching and League restrictions are preserved. A failed write stops starting additional transactions; earlier successful public metadata cache writes remain, as before. No deck, Inventory, commitments or audits are changed by these lookup helpers. The price-preserving upsert transaction is unchanged.

Eight actual-module regression controls pass. On unchanged merged source 3484b2a0, six intended controls fail and two pass: one-slot manual/deck lookups fail, and both paths continue starting writes after a failure. The patch passes all eight. Thirteen exact-feedback controls and 50 applicable metadata/Pricing/import safety controls pass; typecheck passes. The initially supplied nonexistent pricing filename did not run; the actual existing metadata/Pricing suites were subsequently selected and passed.

Real PostgreSQL pressure and compiled desktop/phone checks are pending. No production write or deployment is authorized by this branch.
