import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { bootstrapAdmin } from "../lib/admin-bootstrap";

function fixture(
  existing: object | null = null,
  usedNames: string[] = [],
  usedDisplays: string[] = [],
) {
  const writes: any[] = [];
  const reads: any[] = [];
  let locks = 0;
  const tx = {
    $queryRaw: async () => {
      locks++;
    },
    user: {
      findFirst: async (query: any) => {
        reads.push(query);
        return existing;
      },
      create: async (query: any) => {
        writes.push(query.data);
        return { id: "new-admin" };
      },
    },
    player: {
      findUnique: async ({ where }: any) =>
        usedNames.includes(where.name) ||
        usedDisplays.includes(where.displayName)
          ? { id: "taken" }
          : null,
    },
  };
  return {
    db: { $transaction: async (run: any) => run(tx) } as any,
    writes,
    reads,
    locks: () => locks,
  };
}

const options = {
  username: "Admin",
  password: "fixture-only-secret",
  displayName: "Administrator",
};

test("bootstrap creates a new admin and owner atomically with a hashed temporary password", async () => {
  const f = fixture();
  assert.deepEqual(await bootstrapAdmin(f.db, options), {
    created: true,
    userId: "new-admin",
  });
  assert.equal(f.locks(), 1);
  assert.equal(f.writes.length, 1);
  const created = f.writes[0];
  assert.equal(created.role, "ADMIN");
  assert.equal(created.forcePasswordChange, true);
  assert.equal(created.isActive, true);
  assert.equal(
    await bcrypt.compare(options.password, created.passwordHash),
    true,
  );
  assert.equal(created.player.create.name, "administrator");
  assert.equal(created.player.create.isAdmin, true);
});

test("bootstrap leaves every existing account field unchanged, including disabled or non-admin accounts", async () => {
  for (const role of ["ADMIN", "PLAYER"]) {
    for (const isActive of [false, true]) {
      const original = {
        id: "existing",
        role,
        isActive,
        forcePasswordChange: false,
        passwordHash: "operator-hash",
        displayName: "Custom",
        playerId: null,
      };
      const f = fixture(Object.freeze(original));
      assert.deepEqual(await bootstrapAdmin(f.db, options), {
        created: false,
        userId: "existing",
      });
      assert.deepEqual(f.writes, []);
      assert.equal(original.passwordHash, "operator-hash");
      assert.equal(original.forcePasswordChange, false);
      assert.deepEqual(f.reads[0].where, {
        username: { equals: "Admin", mode: "insensitive" },
      });
    }
  }
});

test("bootstrap chooses an unused owner name without changing an existing owner", async () => {
  const f = fixture(
    null,
    ["administrator", "administrator-1"],
    ["Administrator"],
  );
  await bootstrapAdmin(f.db, options);
  assert.equal(f.writes[0].player.create.name, "administrator-2");
  assert.equal(f.writes[0].player.create.displayName, "Administrator (1)");
});
