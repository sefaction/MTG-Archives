# Production client manifest guard (#223)

An earlier healthy Linux image failed on `/imports`: `SingleCardInventoryAdd` was absent from that route's React Client Manifest (digest `1764835380`). A clean rebuild of unchanged application code recovered. The compiler-internal cause remains unproven; a healthy login page alone did not catch the broken Imports artifact.

`npm run build` now runs `scripts/verify-client-manifests.ts` after Next completes. Since the Dockerfile uses this command, the same checks gate local Linux builds and the GitHub image-publishing build.

The guard verifies named client-component references and their emitted chunk files for six routes: Imports, private/public inventory, Locations, deck import, and playtest. It handles Windows/Linux manifest paths and URL-encoded dynamic route chunks. Missing route maps, component references, or chunk files fail the build with a route/component error. It evaluates only locally generated build artifacts, never uploaded content.

This is a focused release guard, not a replacement for browser tests or a claim to validate every component. Maintain the explicit contracts in `lib/build-client-manifests.ts` when renaming covered components/routes, and extend them for critical new surfaces. Unit fixtures cover the observed omission pattern, missing chunks/maps, and encoded route names. The old broken Docker image is no longer locally available, so those tests do not claim a fresh reproduction of that exact historical artifact.

No automatic rebuild retry hides a failure. Investigate the artifact, preserve diagnostics, then deliberately rebuild and revalidate. Current validation belongs in the PR and local review build record.
