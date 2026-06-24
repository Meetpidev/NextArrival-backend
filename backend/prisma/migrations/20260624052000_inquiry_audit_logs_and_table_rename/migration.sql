DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InterestRequestStatus') THEN
    CREATE TYPE "InterestRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"inquiries"') IS NULL AND to_regclass('"interest_requests"') IS NOT NULL THEN
    ALTER TABLE "interest_requests" RENAME TO "inquiries";
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "inquiries" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "tenantMessage" TEXT NOT NULL,
  "status" "InterestRequestStatus" NOT NULL DEFAULT 'PENDING',
  "ownerMessage" TEXT,
  "respondedAt" TIMESTAMP(3),
  "tenantDeletedAt" TIMESTAMP(3),
  "ownerDeletedAt" TIMESTAMP(3),
  "profileSnapshot" JSONB NOT NULL,
  "propertySnapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inquiries_tenantId_fkey'
  ) THEN
    ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inquiries_ownerId_fkey'
  ) THEN
    ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inquiries_propertyId_fkey'
  ) THEN
    ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_propertyId_fkey"
    FOREIGN KEY ("propertyId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "inquiries_tenantId_idx" ON "inquiries"("tenantId");
CREATE INDEX IF NOT EXISTS "inquiries_ownerId_idx" ON "inquiries"("ownerId");
CREATE INDEX IF NOT EXISTS "inquiries_propertyId_idx" ON "inquiries"("propertyId");
CREATE INDEX IF NOT EXISTS "inquiries_status_idx" ON "inquiries"("status");
CREATE INDEX IF NOT EXISTS "inquiries_createdAt_idx" ON "inquiries"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InquiryAuditAction') THEN
    CREATE TYPE "InquiryAuditAction" AS ENUM ('CREATED', 'ACCEPTED', 'DECLINED', 'DELETED_FROM_HISTORY');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "inquiry_audit_logs" (
  "id" TEXT NOT NULL,
  "inquiryId" TEXT NOT NULL,
  "actorId" TEXT,
  "actorRole" TEXT,
  "action" "InquiryAuditAction" NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inquiry_audit_logs_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inquiry_audit_logs_inquiryId_fkey'
  ) THEN
    ALTER TABLE "inquiry_audit_logs" ADD CONSTRAINT "inquiry_audit_logs_inquiryId_fkey"
    FOREIGN KEY ("inquiryId") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "inquiry_audit_logs_inquiryId_createdAt_idx" ON "inquiry_audit_logs"("inquiryId", "createdAt");
CREATE INDEX IF NOT EXISTS "inquiry_audit_logs_actorId_createdAt_idx" ON "inquiry_audit_logs"("actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "inquiry_audit_logs_action_createdAt_idx" ON "inquiry_audit_logs"("action", "createdAt");
