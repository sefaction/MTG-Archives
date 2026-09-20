import assert from "node:assert/strict";
import test from "node:test";
import {
  createStoredSession,
  resolveStoredSession,
  revokeStoredSession,
  sessionTokenHash,
  sessionCredentialHash,
  SESSION_MAX_AGE_SECONDS,
} from "../lib/auth-sessions";

function fixture() {
  const records = new Map<string, any>();
  const user = {
    id: "user",
    passwordHash: "bcrypt-hash",
    isActive: true,
    player: null,
  };
  const store = {
    authSession: {
      create: async ({ data }: any) => {
        records.set(data.tokenHash, { ...data, user });
        return data;
      },
      findUnique: async ({ where }: any) =>
        records.get(where.tokenHash) ?? null,
      deleteMany: async ({ where }: any) => {
        for (const [key, value] of records) {
          if (
            where.tokenHash
              ? key === where.tokenHash
              : value.userId === where.userId &&
                value.expiresAt <= where.expiresAt.lte
          )
            records.delete(key);
        }
        return { count: 1 };
      },
    },
  } as any;
  return { records, user, store };
}

test("sessions are independent 256-bit random credentials stored only as hashes", async () => {
  const f = fixture(),
    now = new Date("2026-09-20T00:00:00Z");
  const a = await createStoredSession(f.store, f.user, now);
  const b = await createStoredSession(f.store, f.user, now);
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(f.records.has(a), false);
  assert.equal(f.records.size, 2);
  const stored = f.records.get(sessionTokenHash(a)!);
  assert.equal(
    stored.expiresAt.getTime() - now.getTime(),
    SESSION_MAX_AGE_SECONDS * 1000,
  );
  assert.equal(
    stored.credentialHash,
    sessionCredentialHash(f.user.passwordHash),
  );
  assert.equal(await resolveStoredSession(f.store, a, now), f.user);
});

test("raw identities, malformed and unissued session credentials are rejected", async () => {
  const f = fixture();
  for (const token of [
    undefined,
    "",
    "user",
    "x".repeat(42),
    "!".repeat(43),
    "x".repeat(10000),
    "a".repeat(43),
  ]) {
    assert.equal(await resolveStoredSession(f.store, token), null);
  }
});

test("server expiry cannot be extended by replaying a cookie", async () => {
  const f = fixture(),
    now = new Date("2026-09-20T00:00:00Z");
  const token = await createStoredSession(f.store, f.user, now);
  assert.equal(
    await resolveStoredSession(
      f.store,
      token,
      new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
    ),
    null,
  );
});

test("password changes and disabled accounts invalidate existing credentials", async () => {
  const f = fixture();
  const token = await createStoredSession(f.store, f.user);
  f.user.isActive = false;
  assert.equal(await resolveStoredSession(f.store, token), null);
  f.user.isActive = true;
  f.user.passwordHash = "new-password-hash";
  assert.equal(await resolveStoredSession(f.store, token), null);
});

test("logout revokes only the selected session and tolerates legacy credentials", async () => {
  const f = fixture();
  const a = await createStoredSession(f.store, f.user),
    b = await createStoredSession(f.store, f.user);
  await revokeStoredSession(f.store, a);
  await revokeStoredSession(f.store, "user");
  assert.equal(await resolveStoredSession(f.store, a), null);
  assert.equal(await resolveStoredSession(f.store, b), f.user);
});
