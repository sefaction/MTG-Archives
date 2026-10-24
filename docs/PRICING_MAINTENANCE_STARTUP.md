# Pricing maintenance startup qualification

Issue: [#714](https://github.com/sefaction/MTG-Archives/issues/714). Base: main `5e7adbf9796211daf00616e3991ccc17d3af509a`. Branch: `codex/pricing-maintenance-restart-policy`.

## Selected-profile startup policy

On October 23, 2026, Brian chose **“Start with the optional profile”** for #714. The restart-loop repair #720 is already merged and verified on the reported Unraid installation. The remaining proposal aligns the selected installation's saved profile/startup recipe with that choice; it does not change repository defaults or archive permissions.

| Setting | Proposed state for the selected installation | Verification before calling it applied |
| --- | --- | --- |
| Saved profile selection | Include `pricing-archive-maintenance`; preserve every other selected profile. | Read back the installed manager's saved selection and rendered service set. |
| Startup with that profile | A normal project start using the saved selection starts `pricing-archive-maintenance` and `pricing-verify-postgres` automatically. No separate manual service-start step is needed. | Confirm both services belong to the selected profile and the maintenance dependency waits for verifier health. |
| Project boot/autostart | Use that same saved profile selection whenever the project's existing startup mechanism runs. | Record the actual manager version, startup mechanism and selection it uses. Preserve unrelated project/host startup settings. |
| Maintenance restart policy | Keep `restart: "no"`. The authorized runner already polls and retries ordinary tick failures. | Record effective restart policy, exit/running state and restart count after startup. |
| Archive authorization and recovery settings | Preserve the existing approved environment, backup mounts, verifier identity and activation gates. Profile selection is startup policy, not an archive-write grant. | Compare those settings with the pre-change record; use [the activation procedure](PRICING_ARCHIVE_ACTIVATION.md) for any separately authorized activation. |

The normal profile path already exists in the flat and layered Compose templates. With valid authorized settings it starts the existing polling process. With maintenance opt-in disabled, the apply command instead exits once with the visible authorization refusal and zero automatic restarts. That is a refused startup, not a healthy enabled maintenance job; changing permission flags to clear that refusal is outside this profile-alignment proposal. Repository templates continue to omit the profile and leave archive switches off by default.

### Installation handoff and rollback

Before a separately authorized installation change, capture the current Compose Manager version, saved selection, active profile record, project startup settings, rendered services, container identities and effective maintenance settings. The old `running_profiles=*` observation is historical, not a current-state inventory or a proposed value. Use the installed manager's supported controls rather than guessing its file format or overwriting its active-state record.

Review the difference against the table above. Preserve other profiles, private environment values, mounts and ordinary service settings. If the selected profile is already saved and used by normal project startup, record that alignment as a no-op rather than recreating services unnecessarily. A concurrent configuration change requires a fresh comparison.

After an authorized apply, read back saved and effective selections, verify a normal project start uses them, and record actual service state/logs. A disabled guard must retain the single refusal without a restart loop; an authorized runner must have its separate activation/recovery evidence. Confirm ordinary application/service health and unchanged storage identities. For rollback, restore only the reviewed profile/startup selection from its pre-change record, preserving subsequent unrelated edits, archive data and permissions; then read back the effective state again.

This is a reviewable desired-state proposal. No current installation inspection, profile/autostart change, activation, deletion or deployment is evidenced by these instructions. #714 stays open for individual review and the authorized named-installation verification. The qualification and source bindings below describe the earlier #720 repair, not a new runtime run for this proposal.

## Problem and change

The optional maintenance profile starts an apply-mode process. With maintenance disabled, the existing authorization guard exits before SQL, recovery cleanup or archive work. Both base and flat Unraid Compose previously used `unless-stopped`, so Docker repeatedly restarted that intentionally rejected process. Profile selection, including Compose Manager wildcard selection, does not grant maintenance permission.

Only this service now uses `restart: "no"`. The opt-in guard, apply prerequisites, maintenance window, leases, retries, raw-retention controls and application code are unchanged. Ordinary web, pricing and notification service restart policies are unchanged. Successful maintenance startup still enters the existing polling loop and catches retryable tick errors. Docker does not retry a fatal startup failure or unexpected process termination; a later operator restart or normal project start with the selected profile can start the service again. This deliberate tradeoff keeps authorization and recovery failures visible instead of continually retrying an operator-controlled destructive maintenance service.

## Verification

- Typecheck and 19 focused authorization, maintenance-window, recovery-copy and deployment tests pass.
- New process coverage rejects unset, empty, `0`, `false` and `true` maintenance values before database/recovery work, even with local mode selected. Existing tests retain exact local/production authorization and recovery prerequisite requirements.
- The expanded existing CI Compose verifier checks flat Unraid, layered local and layered production/Unraid deployments: the maintenance and verifier services are absent by default, selected-profile maintenance does not restart, all apply/retention switches remain off, and ordinary daemon restart policies remain intact. It passes on the change and fails at the new restart assertion against original main Compose files. Original verifier isolation/mount assertions remain.
- Actual local Docker reproduction uses the rendered service command and environment, with a reused application image whose maintenance and authorization source exactly match the branch after line-ending normalization. Image: `sha256:1ec9ef474d1ff6daf94d1cac38c1245c0018c5258b72c6cec565bf013c9289e7`.
- The old flat restart policy repeats the expected rejection and reaches two restarts. Corrected flat, layered local and layered production services each exit with code 1, zero restarts and exactly one authorization error. Their finished timestamp and zero restart count remain unchanged after an additional 12-second observation. Exit code 1 is the expected visible refusal, not an assertion of a healthy enabled service.
- Every runtime fixture has network mode `none`, a read-only root filesystem, temporary `/tmp`, and no archive/database mounts. No live database or archive is accessible. All 13 ordinary MTG Archives container identities are identical before/after these cases. Baseline and layered fixtures are retired; the corrected flat specimen remains loaded for review.

Full `npm run verify:core` passes: Prisma generation, typecheck, all 878 unit tests, optimized production build and all 13 client manifest guards. No UI behavior changes; shared browser/database fixtures were not run because another chat owns that environment, and isolated startup/Compose checks directly cover this configuration change.

## Local review and deployment boundary

The corrected stopped specimen is `mtg-maintenance714-flat-corrected-pricing-archive-maintenance-1`. Inspect its restart policy, exit code, restart count and logs. Its private generated configuration and qualification results are in `.local-data/pricing-maintenance-714/flat-corrected.json` and `results.json`; the private runtime driver is `docker-check.mjs` in that directory. These fixtures reuse the qualified cumulative application image because this change affects Compose configuration only. There is no UI change or application rebuild/restart needed to exercise this fix. The ordinary cumulative application remains available; another chat owns its Docker build lock.

Do not apply a generated fixture file to Unraid: it is deliberately isolated and contains dummy environment values. The supported actual templates and operator procedure are in `docker-compose.unraid.flat.yml`, `docker-compose.yml` and [PRICING_RETENTION.md](PRICING_RETENTION.md#maintenance-startup-and-compose-manager).

The original qualification made no production connection, profile/configuration update, opt-in, raw deletion, migration or deployment. Its subsequent approved #720 rollout is recorded in #714; that rollout verified the refusal/restart fix while preserving profile/autostart and archive settings. The selected-profile policy above now records the operator's remaining choice. Named-installation alignment still requires its own authorized verification; #714 remains open for that scope.
