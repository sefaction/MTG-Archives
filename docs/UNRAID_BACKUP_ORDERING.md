# MTG-only backup ordering proposal

Related to [#859](https://github.com/sefaction/MTG-Archives/issues/859).
This is an operator-review proposal, not an applied backup configuration or a
claim that the incident is resolved. Production inspection and configuration
changes require separate authority under AGENTS.md. No backup/restart/deployment
or application-data mutation is part of this documentation batch.

## Problem and current evidence

The retained October19backup log shows the web application restarted before the
pricing and application databases finished their own stop/backup/start windows.
Acquisition/catalogue/recognition and pricing dependents were still active during
database downtime. The associated connection failures and restarts remain failed
historical evidence. Later recovery does not establish full-job or restore success.
The exact installed plugin version, effective MTG selection and group/order/skip
settings are absent from the retained local evidence. Do not equate a current
upstream source review with the installed version.

## Supported candidate and important limits

Upstream Appdata.Backup commit `cf336627b85060d296e8dac8df738c7b798cbd2c`
implements a group as one stopped backup unit inside per-container mode. Group
members use reverse stop and forward start ordering. It preserves previously
stopped/paused state; `dontStop` prevents stopping. Starts use container-start
responses and an autostart delay, not a database-health gate. Group recursion
also invokes the backup hook, so existing hook behavior must be inspected.
See [the pinned helper](https://github.com/Commifreak/unraid-appdata.backup/blob/cf336627b85060d296e8dac8df738c7b798cbd2c/src/include/ABHelper.php).

The pinned [settings implementation](https://github.com/Commifreak/unraid-appdata.backup/blob/cf336627b85060d296e8dac8df738c7b798cbd2c/src/include/ABSettings.php)
separates group membership/order, skipping a container, skipping its archive and
leaving it running. Those settings are not interchangeable. Its constructor can
migrate/write configuration; a read-only inspection must read plain files and
must not instantiate the settings class or execute plugin scripts.

## Proposed MTG-scoped change, conditional on installed-source verification

1. Place the actual MTG application databases, Redis, web, backup service and
   every enabled dependent MTG worker in one named group. Derive exact membership
   from the current MTG Compose labels/dependency graph, not a historical count,
   a name prefix alone or the repository's default replica count. Leave unrelated
   applications and intentionally stopped/paused services in their current state.
2. Use dependency-first start order and its reverse for stopping: datastore
   dependencies before their consumers; web/worker relationships follow the
   installed graph. Stop every active MTG writer before either database is stopped.
   Do not assume Docker-start order applies Compose health conditions.
3. Preserve current archive paths, exclusions, verification, schedule and retention.
   A worker may avoid a redundant archive only after mount/source ownership proves
   it has no unique required data. Skipping its archive must not remove its stop/start
   participation. No broad host stop-all, pruning or retention change is proposed.
4. Explicitly qualify startup recovery. Grouping removes the observed independent
   database-backup windows but does not prove databases are ready before consumers
   start. Measure one bounded matching-version local window before accepting a
   delay, hook or existing retry behavior. Choose any extra hook only after its
   supported stage and repeated/group invocation behavior are verified.

Tradeoff: the MTG web service stays unavailable for the combined group backup,
which can exceed its former individual window. This buys one quiescent MTG write
window without stopping unrelated applications. Expected shutdown/start events
must be declared, not hidden by replacing the failed historical baseline.

## Minimal read-only installed inspection before selecting the remedy

| Resource | Collect only | Exclude |
| --- | --- | --- |
| Installed plugin version and helper/settings files | Version text and SHA256code identities; compare relevant supported behavior | Importing/executing plugin code or migrations |
| Plugin JSON configuration | Settings version, method, MTG member group/order and effective skip/dontStop/archive flags; hook presence | Raw config, destinations, hook contents and unrelated application settings |
| Unraid autostart data | MTG order/delay values | Other applications |
| MTG container metadata | Exact IDs/project/service/dependency labels, running/paused/health/restart policy and persistent-mount overlap | Environment variables, credentials, queries and private application records |

Read the installed version at
`/usr/local/emhttp/plugins/appdata.backup/version` and plain JSON at
`/boot/config/plugins/appdata.backup/config.json`; treat missing/different paths
as an evidence gap. No SSH/container command is executed by this proposal.
Capture a compact sanitized report locally, never raw secret-bearing inspection.
A later configuration-change request must identify the exact proposed delta and
preserve an operator-reviewed rollback of the original settings.

## Required local recovery and acceptance gate

After installation/source/settings are known, use an isolated matching-version
fixture and a declared resource/deadline envelope. Preserve current review and
production resources. Observe one dependency-unavailable control and one proposed
ordered window, retaining connection failures, job/lease identities, explicit
lifecycle changes and all original input/review/Inventory state. Finish with one
ordinary job after recovery and exact owned cleanup. Stop at the declared result
or deadline; do not repeat unchanged passes, provoke resource exhaustion, change
worker limits or operate scanner hardware.

A source/simulated-order check alone cannot pass this gate. Current upstream
behavior, original log correlation, local software recovery, full backup-job
completion, restore usability and operator acceptance remain separate evidence.
Keep #859 open until the supported installed configuration and recovery criteria
are accepted; this proposal delivers the concrete next operation and candidate,
not a production fix or permission to apply one.