CREATE TABLE "ScannerPairing" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "codeHash" TEXT NOT NULL UNIQUE CHECK ("codeHash" ~ '^[a-f0-9]{64}$'),
  "credentialHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAgentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ScannerAgent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "tokenHash" TEXT NOT NULL UNIQUE CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  "credentialHash" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "agentVersion" TEXT,
  "devices" JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof("devices") = 'array'),
  "lastSeenAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ScannerPairing_userId_expiresAt_idx" ON "ScannerPairing"("userId", "expiresAt");
CREATE INDEX "ScannerAgent_userId_revokedAt_expiresAt_idx" ON "ScannerAgent"("userId", "revokedAt", "expiresAt");
