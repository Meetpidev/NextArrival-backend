DO $$
BEGIN
  IF to_regclass('"inquiries"') IS NULL AND to_regclass('"interest_requests"') IS NOT NULL THEN
    ALTER TABLE "interest_requests" RENAME TO "inquiries";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InquiryAuditAction') THEN
    CREATE TYPE "InquiryAuditAction" AS ENUM ('CREATED', 'ACCEPTED', 'DECLINED', 'DELETED_FROM_HISTORY');
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('"inquiries"') IS NOT NULL AND to_regclass('"inquiry_audit_logs"') IS NULL THEN
    CREATE TABLE "inquiry_audit_logs" (
      "id" TEXT NOT NULL,
      "inquiryId" TEXT NOT NULL,
      "actorId" TEXT,
      "actorRole" TEXT,
      "action" "InquiryAuditAction" NOT NULL,
      "metadata" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "inquiry_audit_logs_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "inquiry_audit_logs_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE INDEX "inquiry_audit_logs_inquiryId_createdAt_idx" ON "inquiry_audit_logs"("inquiryId", "createdAt");
    CREATE INDEX "inquiry_audit_logs_actorId_createdAt_idx" ON "inquiry_audit_logs"("actorId", "createdAt");
    CREATE INDEX "inquiry_audit_logs_action_createdAt_idx" ON "inquiry_audit_logs"("action", "createdAt");
  END IF;
END $$;
