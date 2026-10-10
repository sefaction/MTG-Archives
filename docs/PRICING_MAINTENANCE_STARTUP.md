# Pricing maintenance startup qualification

Issue: [#714](https://github.com/sefaction/MTG-Archives/issues/714). Base: main `5e7adbf9796211daf00616e3991ccc17d3af509a`. Branch: `codex/pricing-maintenance-restart-policy`.

## Problem and change

The optional maintenance profile starts an apply-mode process. With maintenance disabled, the existing authorization guard exits before SQL, recovery cleanup or archive work. Both base and flat Unraid Compose previously used `unless-stopped`, so Docker repeatedly restarted that intentionally rejected process. Profile selection, including Compose Manager wildcard selection, does not grant maintenance permission.

Only this service now uses `restart: "no"`. The opt-in guard, apply prerequisites, maintenance window, leases, retries, raw-retention controls and application code are unchanged. Ordinary web, pricing and notification service restart policies are unchanged. Successful maintenance startup still enters the existing polling loop and catches retryable tick errors. A fatal startup failure, unexpected process termination or host stop now needs an explicit operator restart. This deliberate tradeoff keeps authorization and recovery failures visible instead of continually retrying an operator-controlled destructive maintenance service.

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

No production connection, profile/configuration update, opt-in, raw deletion, migration or deployment occurred. The reported Unraid state is not claimed repaired. After approved rollout, an existing container must be recreated to take the new policy. Compose Manager's saved/active profile and autostart choice still need operator reconciliation; do not enable maintenance to clear the refusal. Leave the PR open for scheduled review and individual human merge approval, and keep #714 open/in-progress until its reviewed fix is merged.
