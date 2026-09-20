import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { bootstrapAdmin } from "../lib/admin-bootstrap";

async function main() {
  if (process.env.MTG_LOCAL_PILOT_TEST !== "1") {
    throw new Error(
      "This fixture requires MTG_LOCAL_PILOT_TEST=1 on the local disposable snapshot.",
    );
  }
  const db = new PrismaClient();
  const prefix = `bootstrap-audit-${randomUUID()}`;
  let ownerId: string | null = null;
  try {
    const options = {
      username: prefix,
      password: randomUUID(),
      displayName: prefix,
    };
    const results = await Promise.all([
      bootstrapAdmin(db, options),
      bootstrapAdmin(db, { ...options, username: prefix.toUpperCase() }),
    ]);
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(results[0].userId, results[1].userId);
    const created = await db.user.findUniqueOrThrow({
      where: { id: results[0].userId },
      include: { player: true },
    });
    ownerId = created.playerId;
    assert.ok(ownerId);
    assert.equal(
      await bcrypt.compare(options.password, created.passwordHash),
      true,
    );
    assert.equal(created.forcePasswordChange, true);
    assert.equal(created.role, "ADMIN");
    assert.equal(created.player?.isAdmin, true);

    const changed = await db.user.update({
      where: { id: created.id },
      data: {
        passwordHash: await bcrypt.hash(randomUUID(), 10),
        forcePasswordChange: false,
        role: "PLAYER",
        isActive: false,
        displayName: `${prefix} changed`,
      },
    });
    const ownerBefore = await db.player.update({
      where: { id: ownerId },
      data: { active: false, isAdmin: false, color: "#123456" },
    });
    const repeat = await bootstrapAdmin(db, {
      ...options,
      username: prefix.toUpperCase(),
      password: randomUUID(),
      displayName: "Ignored replacement",
    });
    assert.equal(repeat.created, false);
    assert.deepEqual(
      await db.user.findUniqueOrThrow({ where: { id: created.id } }),
      changed,
    );
    assert.deepEqual(
      await db.player.findUniqueOrThrow({ where: { id: ownerId } }),
      ownerBefore,
    );
    console.log(
      "PASS: concurrent fresh bootstrap creates one account/owner; repeated case-insensitive bootstrap preserves all account and owner fields.",
    );
  } finally {
    const fixtures = await db.user.findMany({
      where: { username: { equals: prefix, mode: "insensitive" } },
      select: { id: true, playerId: true },
    });
    await db.user.deleteMany({
      where: { id: { in: fixtures.map((u) => u.id) } },
    });
    const ownerIds = [
      ...new Set(
        [ownerId, ...fixtures.map((u) => u.playerId)].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    await db.player.deleteMany({ where: { id: { in: ownerIds } } });
    assert.equal(
      await db.user.count({
        where: { username: { equals: prefix, mode: "insensitive" } },
      }),
      0,
    );
    assert.equal(await db.player.count({ where: { displayName: prefix } }), 0);
    await db.$disconnect();
    console.log("Bootstrap audit fixtures removed.");
  }
}

main().catch(() => {
  console.error(
    "Bootstrap audit failed; inspect assertions locally without publishing account data.",
  );
  process.exitCode = 1;
});
