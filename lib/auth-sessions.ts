import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
type SessionStore = Pick<Prisma.TransactionClient, "authSession">;

export function sessionTokenHash(token?: string | null) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCredentialHash(passwordHash: string) {
  return createHash("sha256").update(passwordHash).digest("hex");
}

export async function createStoredSession(
  store: SessionStore,
  user: { id: string; passwordHash: string },
  now = new Date(),
) {
  const token = randomBytes(32).toString("base64url");
  await store.authSession.deleteMany({
    where: { userId: user.id, expiresAt: { lte: now } },
  });
  await store.authSession.create({
    data: {
      tokenHash: sessionTokenHash(token)!,
      userId: user.id,
      credentialHash: sessionCredentialHash(user.passwordHash),
      expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
    },
  });
  return token;
}

export async function resolveStoredSession(
  store: SessionStore,
  token?: string | null,
  now = new Date(),
) {
  const tokenHash = sessionTokenHash(token);
  if (!tokenHash) return null;
  const session = await store.authSession.findUnique({
    where: { tokenHash },
    include: { user: { include: { player: true } } },
  });
  if (
    !session ||
    session.expiresAt <= now ||
    !session.user.isActive ||
    session.credentialHash !== sessionCredentialHash(session.user.passwordHash)
  )
    return null;
  return session.user;
}

export async function revokeStoredSession(
  store: SessionStore,
  token?: string | null,
) {
  const tokenHash = sessionTokenHash(token);
  if (tokenHash) await store.authSession.deleteMany({ where: { tokenHash } });
}
