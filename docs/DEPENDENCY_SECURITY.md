# Dependency maintenance (#225)

The 2026-09-19 audit found seven affected production dependency entries (one critical, six high), plus development-tool findings. This was an audit of known advisories, not evidence of exploitation or proof that every vulnerable path was reachable.

## Scoped changes

- Next 15.5.19 → 15.5.25; remain on Next 15. See the [maintainer AVIF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) and [15.5.25 release](https://github.com/vercel/next.js/releases/tag/v15.5.25).
- Sharp 0.34.5 → 0.35.4, supported by Next 15.5.25's optional dependency range; validate the native library inside Linux Docker as well as Windows.
- PostCSS 8.5.28, including an explicit override of Next's pinned 8.4.31. Same major version; validate generated production CSS and browser layouts.
- Nanoid 3.3.19 and compatible development-tool patch/minor updates through the existing ranges. No `npm audit fix --force` or framework-major migration.
- Prisma and its generated client remain at 6.19.3. Only `@prisma/config`'s `deepmerge-ts` is overridden to 8.0.2. This is a deliberate transitive major override: [v8 changes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0) include Map merging and circular-reference handling. Prisma uses its exported `deepmerge` during config loading; this repository's checked-in config is a plain object, not a Map/custom merge API. Validate config loading, generation, build, and migration status. Revisit/remove the override when an upstream-compatible Prisma release resolves it.

## Validation

After lockfile refresh, both `npm audit` and `npm audit --omit=dev` report zero known vulnerabilities. Audit results are time-specific and do not establish absence of all vulnerabilities. Exact build/browser results are recorded in the PR and local review build; pre-existing query-latency failures (#224) must not be relabeled as passes.

No schema/data migration, production deployment, or merge is included in this change.
