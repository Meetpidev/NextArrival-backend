DROP INDEX IF EXISTS "inquiries_tenant_property_unique_idx";

DO $$
BEGIN
  IF to_regclass('"inquiries"') IS NOT NULL THEN
    CREATE UNIQUE INDEX "inquiries_tenant_property_unique_idx"
    ON "inquiries"("tenantId", "propertyId")
    WHERE "tenantDeletedAt" IS NULL;
  END IF;
END $$;
