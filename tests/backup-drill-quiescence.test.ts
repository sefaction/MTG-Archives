import assert from "node:assert/strict";
import test from "node:test";
import {
  changedDrillTables,
  withQuiescentDrill,
  type DrillService,
} from "../lib/backup-drill-quiescence";

const services: DrillService[] = [
  { id: "web-id", service: "web", running: true, paused: false },
  { id: "worker-id", service: "worker", running: true, paused: false },
  { id: "stopped-id", service: "stopped", running: false, paused: false },
];
test("failed capture restores original running services before propagating failure", async () => {
  const calls: string[] = [];
  const phases: any[] = [];
  await assert.rejects(
    withQuiescentDrill(
      services,
      (action, entry) => {
        calls.push(`${action}:${entry.id}`);
      },
      (state) => phases.push(state),
      async () => {
        throw new Error("capture rejected");
      },
    ),
    /capture rejected/,
  );
  assert.deepEqual(calls, [
    "stop:worker-id",
    "pause:web-id",
    "unpause:web-id",
    "start:worker-id",
  ]);
  assert.equal(phases.at(-1).phase, "restored");
});
test("an ambiguous stop failure still attempts restoration of that exact worker", async () => {
  const calls: string[] = [];
  await assert.rejects(
    withQuiescentDrill(
      services,
      (action, entry) => {
        calls.push(`${action}:${entry.id}`);
        if (action === "stop") throw Error("stop");
      },
      () => {},
      async () => assert.fail("must not capture"),
    ),
    /stop/,
  );
  assert.deepEqual(calls, ["stop:worker-id", "start:worker-id"]);
});
test("web restoration failure does not prevent restoring workers and is journaled", async () => {
  const calls: string[] = [];
  const phases: any[] = [];
  await assert.rejects(
    withQuiescentDrill(
      services,
      (action, entry) => {
        calls.push(`${action}:${entry.id}`);
        if (action === "unpause") throw Error("unpause");
      },
      (state) => phases.push(state),
      async () => true,
    ),
    /restoration failed: web/,
  );
  assert.equal(calls.at(-1), "start:worker-id");
  assert.equal(phases.at(-1).phase, "restoration-incomplete");
});
test("pre-paused workers or stopped web reject before any mutation", async () => {
  for (const invalid of [
    services.map((s) => ({ ...s, paused: s.service === "worker" })),
    services.map((s) => ({ ...s, running: s.service !== "web" })),
  ])
    await assert.rejects(
      withQuiescentDrill(
        invalid,
        () => assert.fail("mutation"),
        () => assert.fail("journal"),
        async () => true,
      ),
      /requires/,
    );
});

test("ambiguous pause failure resumes web and success keeps originally stopped workers stopped", async () => {
  for (const failPause of [true, false]) {
    const calls: string[] = [];
    const operation = withQuiescentDrill(
      services,
      (action, entry) => {
        calls.push(`${action}:${entry.id}`);
        if (failPause && action === "pause") throw Error("pause");
      },
      () => {},
      async () => "captured",
    );
    if (failPause) await assert.rejects(operation, /pause/);
    else assert.equal(await operation, "captured");
    assert.deepEqual(calls, [
      "stop:worker-id",
      "pause:web-id",
      "unpause:web-id",
      "start:worker-id",
    ]);
  }
});
test("changed-table diagnostics identify additions/deletions/count or content changes without fingerprints", () => {
  const result = changedDrillTables(
    {
      A: { rows: 1, digest: "secret" },
      B: { rows: 2, digest: "same" },
      Deleted: { rows: 1, digest: "private" },
    },
    {
      A: { rows: 1, digest: "other" },
      B: { rows: 2, digest: "same" },
      New: { rows: 3, digest: "sensitive" },
    },
  );
  assert.deepEqual(
    result.map((entry) => entry.table),
    ["A", "Deleted", "New"],
  );
  assert.equal(result[0].contentChanged, true);
  assert.ok(!/secret|private|sensitive|digest/.test(JSON.stringify(result)));
});
