CREATE UNIQUE INDEX IF NOT EXISTS "inquiries_tenant_property_unique_idx" ON "inquiries"("tenantId", "propertyId");
