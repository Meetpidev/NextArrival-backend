DROP INDEX IF EXISTS "inquiries_tenant_property_unique_idx";
DROP INDEX IF EXISTS "interest_requests_tenantId_propertyId_key";
DROP INDEX IF EXISTS "inquiries_tenantId_propertyId_key";

ALTER TABLE IF EXISTS "interest_requests"
  DROP CONSTRAINT IF EXISTS "interest_requests_tenantId_propertyId_key";
ALTER TABLE IF EXISTS "inquiries"
  DROP CONSTRAINT IF EXISTS "inquiries_tenantId_propertyId_key";

DO $$
BEGIN
  IF to_regclass('"inquiries"') IS NOT NULL THEN
    CREATE UNIQUE INDEX "inquiries_tenant_property_unique_idx"
    ON "inquiries"("tenantId", "propertyId")
    WHERE "tenantDeletedAt" IS NULL;
  END IF;
END $$;
