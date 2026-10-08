# Preserve footer set and language pairs

Issue [675](https://github.com/sefaction/MTG-Archives/issues/675) records a reproducible metadata attribution bug. With footer readings `ABC FR`, `XYZ EN`, and collector `7`, external catalog queries preserve the two observed pairs. The local resolver previously flattened the languages and could give both English and French printings of both sets exact footer support. A synthetic four-printing baseline reproduced that behavior.

The resolver now selects languages within each observed set. If that set has no matching local language, its candidates retain an explicit language contradiction. Title alternatives and stamped List source-footer aliases use the same pairing. Orientation observations remain separate; image candidates can remain available for review without acquiring unsupported exact footer agreement.

The catalog interpretation generation changes to `catalog-reconciliation-footer-pairs-v8`. Eligible unreviewed saved results can be reinterpreted from existing OCR. New outputs record text policy `metadata-footer-set-language-pairs-v6`. The native OCR generation and proposal schema version remain unchanged; this repair does not require scanning photos again. Existing human reviews, automatic acceptance safeguards, correction policy and Inventory boundaries remain in force.

Qualification is in progress: focused resolver tests and type checking pass. Full core, disposable PostgreSQL refresh/cache/version-fence checks, frozen development OCR replay and cumulative local Docker qualification are pending. Fixture typing failures were corrected before proceeding.

This establishes correct attribution on covered observations. Reused development photos and synthetic cases do not establish a population recognition accuracy gain. Independent validation and the existing verifier/cohort decisions remain separate.
