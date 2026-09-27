import { writeFileSync } from "node:fs";
import { reviewBuildManifest } from "../lib/review-build-provenance";
writeFileSync(
  "build-source-manifest.json",
  JSON.stringify(reviewBuildManifest()),
);
