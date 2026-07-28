import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const compose = readFileSync("docker-compose.yml", "utf8");
const localCompose = readFileSync("docker-compose.local.yml", "utf8");
const prodCompose = readFileSync("docker-compose.prod.yml", "utf8");
const unraidCompose = readFileSync("docker-compose.unraid.yml", "utf8");
const workflow = readFileSync(".github/workflows/docker-publish.yml", "utf8");
const deploymentDocs = readFileSync("docs/DEPLOYMENT.md", "utf8");

function serviceBlock(source: string, serviceName: string) {
  const start = source.indexOf(`  ${serviceName}:`);
  assert.notEqual(start, -1);
  const rest = source.slice(start);
  const next = rest.slice(1).search(/\n  [a-z0-9-]+:/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

test("web and backup services have a GHCR image identity for deployable stacks", () => {
  assert.match(compose, /ghcr\.io\/sefaction\/mtg-archives-web/);
  assert.match(compose, /\$\{IMAGE_TAG:-main\}/);
  assert.match(compose, /backup:/);
  assert.match(compose, /npm run backup:create/);
  assert.match(compose, /tail -f \/dev\/null/);
});

test("pricing worker stack is isolated from the main application database", () => {
  const worker = serviceBlock(compose, "pricing-worker");
  assert.match(compose, /pricing-postgres:/);
  assert.match(compose, /redis:/);
  assert.match(worker, /pricing-worker:/);
  assert.match(worker, /PRICING_DATABASE_URL/);
  assert.match(worker, /npm run worker:prices/);
  assert.doesNotMatch(worker, /\n      DATABASE_URL:/);
});

test("notification worker processes hourly digests from the main database", () => {
  const worker = serviceBlock(compose, "notification-worker");
  assert.match(worker, /DATABASE_URL/);
  assert.match(worker, /npm run worker:notifications/);
  assert.match(worker, /NOTIFICATION_WORKER_INTERVAL_MS/);
  assert.match(worker, /web:\s*\n\s*condition: service_healthy/);
  assert.match(serviceBlock(compose, "web"), /healthcheck:/);
  assert.match(localCompose, /notification-worker:/);
  assert.match(prodCompose, /notification-worker:/);
  assert.match(deploymentDocs, /hourly wishlist windows/);
});

test("local compose layer builds from checkout and avoids machine-specific paths", () => {
  assert.match(localCompose, /context: \./);
  assert.match(localCompose, /mtg-archives-web:local/);
  assert.match(localCompose, /\.\/\.local-data\/uploads/);
  assert.match(localCompose, /\$\{WEB_HOST_PORT:-13001\}:3000/);
  assert.doesNotMatch(localCompose, /C:\\Users\\brian/);
  assert.doesNotMatch(localCompose, /\/mnt\/user\/appdata/);
});

test("production and unraid compose layers are available for image pulls", () => {
  assert.match(prodCompose, /pull_policy: always/);
  assert.match(prodCompose, /pricing-worker:/);
  assert.match(prodCompose, /WEB_IMAGE/);
  assert.match(unraidCompose, /POSTGRES_DATA_PATH/);
  assert.match(unraidCompose, /PRICING_POSTGRES_DATA_PATH/);
  assert.match(unraidCompose, /REDIS_DATA_PATH/);
  assert.match(unraidCompose, /BACKUPS_DATA_PATH/);
});

test("GitHub Actions publishes branch-tagged web images to GHCR", () => {
  assert.match(workflow, /Publish Docker images/);
  assert.match(workflow, /packages: write/);
  assert.match(workflow, /docker\/metadata-action/);
  assert.match(workflow, /type=ref,event=branch/);
  assert.match(workflow, /sefaction\/mtg-archives-web/);
});

test("deployment docs describe main and platform branch image deployment", () => {
  assert.match(deploymentDocs, /IMAGE_TAG=main/);
  assert.match(deploymentDocs, /platform-pricing-worker-stack/);
  assert.match(deploymentDocs, /pricing-worker/);
  assert.match(deploymentDocs, /redis/);
});
