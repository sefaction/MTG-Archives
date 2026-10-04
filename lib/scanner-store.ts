import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { sessionCredentialHash } from "./auth-sessions";
import { scannerCredential, scannerHash, scannerHashMatches, scannerPairClaimSchema,
  scannerPairCode, scannerPulseSchema, scannerSecret, scannerDiscoveryIssuesSchema } from "./scanner-protocol";

import { ScannerConnectionDenied } from "./scanner-errors";
const unavailable = () => new ScannerConnectionDenied();
type Tx = Prisma.TransactionClient;
export async function scannerTransaction<T>(db: PrismaClient, work: (tx: Tx) => Promise<T>) {
  for (let retry = 0; ; retry++) {
    try { return await db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 }); }
    catch (error) {
      if (retry >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !(error.code === "P2034" || error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code)))) throw error;
    }
  }
}
const transaction = scannerTransaction;
async function activeUser(tx: Tx, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, include: { player: true } });
  if (!user?.isActive || !user.player?.active) throw unavailable();
  return user;
}
export async function createScannerPairing(db: PrismaClient, userId: string, now = new Date()) {
  const id = randomUUID(), secret = scannerSecret();
  return transaction(db, async tx => {
    const user = await activeUser(tx, userId);
    await tx.scannerPairing.deleteMany({ where: { userId, expiresAt: { lte: now } } });
    if (await tx.scannerAgent.count({ where: { userId, revokedAt: null, expiresAt: { gt: now } } }) >= 8 ||
      await tx.scannerPairing.count({ where: { userId, claimedAgentId: null } }) >= 8) throw unavailable();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    await tx.scannerPairing.create({ data: { id, userId, codeHash: scannerHash(secret),
      credentialHash: sessionCredentialHash(user.passwordHash), expiresAt } });
    return { version: 1, code: `${id}.${secret}`, expiresAt };
  });
}
export async function claimScannerPairing(db: PrismaClient, value: unknown, now = new Date()) {
  const input = scannerPairClaimSchema.parse(value);
  let code: ReturnType<typeof scannerPairCode>;
  try { code = scannerPairCode(input.pairCode); }
  catch { throw unavailable(); }
  return transaction(db, async tx => {
    const pair = await tx.scannerPairing.findUnique({ where: { id: code.id } });
    if (!pair || pair.expiresAt <= now || !scannerHashMatches(code.secret, pair.codeHash)) throw unavailable();
    const user = await activeUser(tx, pair.userId);
    if (pair.credentialHash !== sessionCredentialHash(user.passwordHash)) throw unavailable();
    const existing = await tx.scannerAgent.findUnique({ where: { id: input.agentId } });
    if (pair.claimedAgentId) {
      if (pair.claimedAgentId !== input.agentId || !existing || existing.userId !== pair.userId ||
        existing.revokedAt || existing.expiresAt <= now || !scannerHashMatches(input.secret, existing.tokenHash) ||
        existing.credentialHash !== pair.credentialHash) throw unavailable();
      return { version: 1, agentId: existing.id, expiresAt: existing.expiresAt, connectionAccount: user.username };
    }
    if (existing || await tx.scannerAgent.count({ where: { userId: pair.userId, revokedAt: null,
      expiresAt: { gt: now } } }) >= 8) throw unavailable();
    const agent = await tx.scannerAgent.create({ data: { id: input.agentId, userId: pair.userId,
      tokenHash: scannerHash(input.secret), credentialHash: pair.credentialHash, name: input.name,
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000) } });
    await tx.scannerPairing.update({ where: { id: pair.id }, data: { claimedAgentId: agent.id } });
    return { version: 1, agentId: agent.id, expiresAt: agent.expiresAt, connectionAccount: user.username };
  });
}
export async function authenticateScanner(tx: Tx, authorization: string | null, now: Date) {
  const credential = scannerCredential(authorization);
  if (!credential) throw unavailable();
  const agent = await tx.scannerAgent.findUnique({ where: { id: credential.id } });
  if (!agent || agent.revokedAt || agent.expiresAt <= now || !scannerHashMatches(credential.secret, agent.tokenHash)) throw unavailable();
  const user = await activeUser(tx, agent.userId);
  if (agent.credentialHash !== sessionCredentialHash(user.passwordHash)) throw unavailable();
  return { agent, actor: { userId: user.id, adminMode: false as const }, connectionAccount: user.username };
}
export async function recordScannerPulse(db: PrismaClient, authorization: string | null, value: unknown, now = new Date()) {
  const pulse = scannerPulseSchema.parse(value);
  return transaction(db, async tx => {
    const { agent, connectionAccount } = await authenticateScanner(tx, authorization, now);
    await tx.scannerAgent.update({ where: { id: agent.id }, data: { lastSeenAt: now,
      agentVersion: pulse.agentVersion, devices: pulse.devices,
      // Native-run keepalive pulses and older helpers omit diagnostics. Only an
      // explicit diagnostic report replaces them; an empty report clears them.
      discoveryIssues: pulse.discoveryIssues } });
    return { version: 1, agentId: agent.id, nextPollMs: 5000, discoveryReporting: true, discoveryProgressReporting: true, connectionAccount };
  });
}
export async function listScannerAgents(db: PrismaClient, userId: string, now = new Date()) {
  return transaction(db, async tx => {
    const user = await activeUser(tx, userId);
    const agents = await tx.scannerAgent.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: now },
      credentialHash: sessionCredentialHash(user.passwordHash) }, orderBy: { createdAt: "desc" } });
    return agents.map(agent => ({ id: agent.id, name: agent.name, agentVersion: agent.agentVersion,
      lastSeenAt: agent.lastSeenAt, online: !!agent.lastSeenAt && now.getTime() - agent.lastSeenAt.getTime() < 30000,
      devices: scannerPulseSchema.parse({ version: 1, agentVersion: agent.agentVersion ?? "unknown",
        devices: agent.devices }).devices,
      discoveryIssues: scannerDiscoveryIssuesSchema.parse(agent.discoveryIssues ?? []) }));
  });
}
export async function revokeScannerAgent(db: PrismaClient, userId: string, agentId: string, now = new Date()) {
  return transaction(db, async tx => {
    await activeUser(tx, userId);
    const result = await tx.scannerAgent.updateMany({ where: { id: agentId, userId }, data: { revokedAt: now } });
    if (!result.count) throw unavailable();
  });
}
