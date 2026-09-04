-- Phase 3 Push Notifications — DevicePushToken (ADDITIVE ONLY)
-- Creates a new table + indexes + FKs. Does not alter or drop any existing CRM tables/data.

-- CreateTable
CREATE TABLE "DevicePushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT,
    "installId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'fcm',
    "token" TEXT NOT NULL,
    "appId" TEXT NOT NULL DEFAULT 'in.massivementor.crm',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPushAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DevicePushToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DevicePushToken_appId_provider_token_key" ON "DevicePushToken"("appId", "provider", "token");

-- CreateIndex
CREATE UNIQUE INDEX "DevicePushToken_appId_installId_key" ON "DevicePushToken"("appId", "installId");

-- CreateIndex
CREATE INDEX "DevicePushToken_userId_enabled_appId_idx" ON "DevicePushToken"("userId", "enabled", "appId");

-- CreateIndex
CREATE INDEX "DevicePushToken_userId_installId_idx" ON "DevicePushToken"("userId", "installId");

-- CreateIndex
CREATE INDEX "DevicePushToken_lastSeenAt_idx" ON "DevicePushToken"("lastSeenAt");

-- CreateIndex
CREATE INDEX "DevicePushToken_businessId_idx" ON "DevicePushToken"("businessId");

-- AddForeignKey
ALTER TABLE "DevicePushToken" ADD CONSTRAINT "DevicePushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevicePushToken" ADD CONSTRAINT "DevicePushToken_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
