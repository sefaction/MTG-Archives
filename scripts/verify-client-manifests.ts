import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLIENT_MANIFEST_CONTRACTS,
  checkClientManifest,
} from "../lib/build-client-manifests";

const buildRoot = resolve(".next");
for (const [route, components] of Object.entries(CLIENT_MANIFEST_CONTRACTS)) {
  const path = resolve(
    buildRoot,
    "server/app",
    `${route.slice(1)}_client-reference-manifest.js`,
  );
  checkClientManifest(readFileSync(path, "utf8"), route, components, (chunk) =>
    existsSync(resolve(buildRoot, chunk)),
  );
  console.log(
    `Client manifest verified: ${route} (${components.length} components)`,
  );
}
