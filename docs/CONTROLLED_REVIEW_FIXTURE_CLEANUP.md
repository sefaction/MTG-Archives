# Controlled review fixture cleanup

PR #774 addresses the demonstrated failure boundaries in #773, under the broader #692 correction-library teardown audit. The affected fixtures are `acquisition-quick-finish.spec.ts` and `acquisition-processing-recovery.spec.ts`.

Their unchanged actual finally blocks leave the disposable Player, User, location, independent correction account and private directory when an embedded feedback sweep fails. Two real PostgreSQL probes reproduce that residue and then recover only those exact owners. Corrected actual-block probes retain the injected error as an aggregate and clear all five namespaces.

Each fixture now independently attempts authenticated polling/session retirement, browser route retirement and navigation, its original database/file teardown, and a final independent feedback sweep. Every failed step remains visible. The original database bodies are unchanged; this does not claim that an arbitrary persistent database outage can be recovered automatically.

A strict optional `MTG_REVIEW_FIXTURE_CONTAINER` selector supports the existing primary local review and the cumulative isolated local review. The original default remains `mtg-archives-web-1` / localhost13001. The isolated choice is `mtg-anchor-qualification-web-1` / localhost13011. Unknown targets, a remote Docker engine and a wrong project label fail before fixture data operations. The single existing exact baseURL assertion now matches this explicit supported target; no deadline or workflow assertion is relaxed.

Qualification on October 13, 2026:

- AST comparison retains all158 original assertion calls, both complete original SQL teardown bodies and all existing120/180-second test and request deadlines.
- Sixteen actual-finally fault/normal and target-selection guards pass, as do types.
- All four complete original controlled desktop/390px UI workflows pass with no skipped cases/retries in about1.2minutes. They retain terminal-state/late-error/manual-recovery, browser draft restore, direct finish availability, original downloads, saved review and explicit Inventory confirmation controls. Phone screenshots were inspected. These are controlled UI statuses and generated images; they are not native/hardware or recognition-accuracy qualification.
- Owned source/auth/card/independent-feedback/Inventory/file namespaces are absent afterward. Seven isolated service identities/configurations/mounts/lifetimes and the loaded620-input source manifest remain unchanged. Test-only changes require no application/native rebuild or runtime mutation. The current cumulative stack retains #772 and all earlier scanner review batches.
- Original156 scan files (898,515,870bytes), the existing correction original and sixteen primary services match a retained baseline preceding these UI cases.

An initial strict cross-run table comparison failed for correction evidence/accounts. Read-only reconciliation proves the original120 evidence rows remain byte-equivalent, with four new SOURCE_JOB records/85,676bytes. Every new canonical bundle hash, byte count, source job owner/photo link and input/output hash matches; subtracting exactly those accounting increments and excluding only cleanup timestamps reconstructs every original substantive account field. Twelve other whole-table fingerprints remain identical. The additions are kept; no historical data or account is restored/deleted to make the comparison pass. The first failed comparison remains retained privately.

Required exact-head CI is authoritative in GitHub and the worker checkpoint. Native original/hardware gates and other #692/#463 acceptance remain separate. Existing64decimalGB/2% policies and production library lifetimes are unchanged. No physical feed, production action, PR readiness or merge is performed by this worker.
