import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const env = {
  ...process.env,
  COMPOSE_PROFILES: "",
  WEB_IMAGE: "fixture-web:review",
  ACQUISITION_RECOGNITION_IMAGE: "fixture-recognition:review",
  DATABASE_URL: "postgresql://fixture:fixture@postgres:5432/fixture",
  ACQUISITION_MODELS_PATH: "/tmp/mtg-models-fixture",
  UPLOADS_DATA_PATH: "/tmp/mtg-uploads-fixture",
};
const config = JSON.parse(
  execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      "docker-compose.unraid.flat.env.example",
      "-f",
      "docker-compose.unraid.flat.yml",
      "config",
      "--format",
      "json",
    ],
    { env, encoding: "utf8" },
  ),
);
const services = config.services;
const web = services.web,
  prepare = services["acquisition-worker"],
  initialize = services["acquisition-model-init"],
  recognize = services["acquisition-recognition-worker"];
assert.ok(
  prepare && initialize && recognize,
  "Both workers and persistent model setup must deploy by default",
);
assert.equal(prepare.image, web.image);
assert.equal(recognize.image, "fixture-recognition:review");
assert.equal(initialize.image, recognize.image);
assert.match(prepare.command.join(" "), /scripts\/acquisition-worker.ts/);
assert.match(initialize.entrypoint.join(" "), /download_models.py/);
for (const worker of [prepare, recognize]) {
  assert.equal(worker.environment.DATABASE_URL, web.environment.DATABASE_URL);
  assert.equal(
    worker.environment.UPLOADS_DATA_PATH,
    web.environment.UPLOADS_DATA_PATH,
  );
  assert.equal(worker.depends_on.web.condition, "service_healthy");
  const upload = worker.volumes.find(
    (v: any) => v.target === web.environment.UPLOADS_DATA_PATH,
  );
  assert.ok(upload);
  assert.equal(
    upload.source,
    web.volumes.find((v: any) => v.target === upload.target).source,
  );
  assert.equal(Boolean(upload.read_only), worker === recognize);
}
assert.equal(
  recognize.depends_on["acquisition-model-init"].condition,
  "service_completed_successfully",
);
assert.equal(initialize.volumes.length, 1);
assert.deepEqual(initialize.environment ?? {}, {});
assert.equal(initialize.volumes[0].target, "/models");
assert.equal(Boolean(initialize.volumes[0].read_only), false);
const models = recognize.volumes.find((v: any) => v.target === "/models");
assert.equal(models.source, initialize.volumes[0].source);
assert.equal(models.read_only, true);
assert.deepEqual(Object.keys(recognize.networks), ["acquisition-internal"]);
assert.equal(config.networks["acquisition-internal"].internal, true);
assert.ok(Object.hasOwn(services.postgres.networks, "acquisition-internal"));
assert.ok(Object.hasOwn(services.postgres.networks, "default"));
assert.equal(services["pricing-archive-maintenance"], undefined);
console.log(
  "PASS: flat acquisition services, persistent paths, model setup ordering and inference isolation",
);
