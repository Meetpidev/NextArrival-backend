-- Keep renamed inquiry tables from carrying legacy FK constraint names alongside new ones.
ALTER TABLE IF EXISTS "inquiries" DROP CONSTRAINT IF EXISTS "interest_requests_tenantId_fkey";
ALTER TABLE IF EXISTS "inquiries" DROP CONSTRAINT IF EXISTS "interest_requests_ownerId_fkey";
ALTER TABLE IF EXISTS "inquiries" DROP CONSTRAINT IF EXISTS "interest_requests_propertyId_fkey";

-- City search uses the PostgreSQL trigram GIN index created by the listing cursor migration.
-- Drop the old btree index so Prisma schema and migration intent stay aligned.
DROP INDEX IF EXISTS "Listing_city_idx";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Listing_city_trgm_idx"
  ON "Listing" USING GIN ("city" gin_trgm_ops);
