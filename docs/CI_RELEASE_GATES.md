# CI verification and ordered image publication (#241)

`npm run verify` remains the full local gate: generation, typecheck, unit tests, production build/client-manifest guards, then browser tests. It now invokes npm through Node and `npm_execpath`, so it works on Windows and Linux without embedding `npm.cmd` in the script. `npm run verify:core` explicitly omits only browser tests.

The read-only `Verify / Core verification` pull-request workflow uses Node 22 and a clean `npm ci`, runs the core gate and has no production credentials, package-write permission or database snapshot. It also supports reuse by the image publisher. Full local browser, capture-email and recovery drills remain required release evidence; they are not represented as covered by CI without a dedicated cloud fixture.

Image publication waits for the same core verification. A per-ref concurrency group permits one publisher with no in-flight cancellation; newer pending work replaces older pending work. Branch-head checks before building and again immediately before pushing reject superseded revisions and late reruns. Images are built/loaded without publishing first. Only the publishing job receives package-write permission; supported publish refs remain main and platform branches.

Concurrency alone does not guarantee commit ordering, so the head checks are intentional. A ref can advance during a push, but no second job in the same ref group can publish a newer image concurrently and then be overwritten by this job. The latest successful eligible run updates the branch tag; failures leave the prior published image. This does not update Unraid or any production container.

On 2026-09-20, after the first successful Linux CI run (35520445332), the user approved required checks. Active repository ruleset `23732060` now requires `Core verification` from the GitHub Actions app (15368) on `main`, with strict up-to-date checks and no bypass actors. This is a separately verified GitHub setting, not something installing this workflow enables automatically. Individual user approval for each PR remains required by project policy; no auto-merge or recurring agent schedule is enabled.

Rollout: older stacked PRs that do not yet contain this workflow must receive the verification tooling and pass the check before merging into main. Do not bypass or disable the rule to ship those PRs. Recheck after each base change. During rollout, cancel superseded **old-definition** publisher runs from earlier merges, since new concurrency settings cannot retroactively govern those runs.

Sources: [GitHub concurrency behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency), [reusable workflow configuration](https://docs.github.com/en/actions/reference/workflows-and-actions/reusing-workflow-configurations). Actual CI run results and local build identity are recorded in the PR/checkpoint.
