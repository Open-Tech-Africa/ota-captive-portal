-- CreateEnum
CREATE TYPE "PackageDuration" AS ENUM ('HOURLY', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING', 'AWAITING_PAYMENT', 'PAID', 'PROVISIONED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MpesaStatus" AS ENUM ('INITIATED', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "PaystackStatus" AS ENUM ('INITIATED', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT', 'REFUNDED');

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "duration" "PackageDuration" NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "priceKes" INTEGER NOT NULL,
    "downKbps" INTEGER NOT NULL,
    "upKbps" INTEGER NOT NULL,
    "radiusGroup" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "shaperDownPipeUuid" TEXT,
    "shaperUpPipeUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalSession" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "email" TEXT,
    "clientMac" TEXT,
    "clientIp" TEXT,
    "zoneId" TEXT,
    "redirectUrl" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING',
    "radiusUsername" TEXT,
    "radiusPasswordOneTime" TEXT,
    "expiresAt" TIMESTAMP(3),
    "shaperClientIp" TEXT,
    "shaperDownRuleUuid" TEXT,
    "shaperUpRuleUuid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MpesaTransaction" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "merchantRequestId" TEXT NOT NULL,
    "checkoutRequestId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" "MpesaStatus" NOT NULL DEFAULT 'INITIATED',
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "mpesaReceiptNumber" TEXT,
    "transactionDate" TIMESTAMP(3),
    "rawCallback" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MpesaTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaystackTransaction" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" "PaystackStatus" NOT NULL DEFAULT 'INITIATED',
    "gatewayResponse" TEXT,
    "paidAt" TIMESTAMP(3),
    "rawWebhook" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaystackTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RadiusProvisionLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RadiusProvisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalSession_status_idx" ON "PortalSession"("status");

-- CreateIndex
CREATE INDEX "PortalSession_radiusUsername_idx" ON "PortalSession"("radiusUsername");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaTransaction_sessionId_key" ON "MpesaTransaction"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "MpesaTransaction_checkoutRequestId_key" ON "MpesaTransaction"("checkoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PaystackTransaction_sessionId_key" ON "PaystackTransaction"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaystackTransaction_reference_key" ON "PaystackTransaction"("reference");

-- AddForeignKey
ALTER TABLE "PortalSession" ADD CONSTRAINT "PortalSession_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MpesaTransaction" ADD CONSTRAINT "MpesaTransaction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PortalSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaystackTransaction" ADD CONSTRAINT "PaystackTransaction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PortalSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RadiusProvisionLog" ADD CONSTRAINT "RadiusProvisionLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PortalSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
