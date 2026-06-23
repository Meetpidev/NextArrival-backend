ALTER TABLE IF EXISTS "interest_requests"
ADD COLUMN IF NOT EXISTS "tenantMessage" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "ownerMessage" TEXT,
ADD COLUMN IF NOT EXISTS "respondedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF to_regclass('"interest_requests"') IS NOT NULL THEN
    ALTER TABLE "interest_requests" ALTER COLUMN "tenantMessage" DROP DEFAULT;
  END IF;
END $$;
