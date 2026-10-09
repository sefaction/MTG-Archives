# Deterministic counted-scanner retention verification

Issue [679](https://github.com/sefaction/MTG-Archives/issues/679) records a database-verification miss during the merge of the UI-only refresh PR674. Its settled error-batch expiry assertion expected one original to be purged and observed zero; the same-head rerun passed.

The counted-scanner verifier created a fresh owner with the normal 2% correction-control sampling policy. A sampled original receives an unreleased correction retention pin until its private copy is preserved. The verifier assumed that its expiry case had no pin and did not run the correction-copy worker. A private, disposable baseline experiment reproduces this missing precondition deterministically on unchanged main71356a7:

| Forced sampling for the error photo | Selected control | Unreleased pins | Expired batches | Purged photos | Failures |
| --- | --- | --- | --- | --- | --- |
| 0% | false | 0 | 1 | 1 | 0 |
| 100% | true | 1 | 0 | 0 | 0 |

The selected case reproduces the original zero-versus-one assertion. Its original is correctly retained. The historical CI run did not record the selection or pin state, so that run's exact database state cannot be recovered from its logs. This experiment establishes a concrete path to the same failure and a flaw in the fixture's random assumptions.

Ordinary inputs for this fixture now use an explicit zero sampling rate. The settled-error photo is explicitly sampled at 100%, and its recorded selection is checked. Expired Trash must retain that original, keep native-original release ineligible and leave the batch unexpired while the correction copy is pending. The real correction-copy worker then preserves the bytes and releases the pin. The acquisition original can expire, the private copy stays readable with identical bytes, native release becomes eligible, and Inventory is conserved. Queue timing and owner-turn preconditions are established only in the disposable fixture; real admission, leases and publication checks still run.

Cleanup removes only the fixture owners' correction records before deleting their temporary source directories. Application sampling, storage limits, retention, scanner control and production behavior are unchanged. This is verification work, not physical feeding, independent recognition accuracy or a new label policy.

The controlled baseline pair passed and its disposable PostgreSQL container/volume were removed. The corrected full disposable PostgreSQL acquisition and shared-import checks pass, including the new real-copy/retention/native-release/Inventory boundary. Standalone type checking passes. Core passes all 853 unit tests, type checking, production build and 13 client manifests. Cumulative images and current-head GitHub qualification are pending.
