-- Replace offset-pagination indexes with indexes that match cursor listing reads.
DROP INDEX IF EXISTS "Listing_status_createdAt_idx";
DROP INDEX IF EXISTS "Listing_ownerId_status_createdAt_idx";
DROP INDEX IF EXISTS "Listing_rent_idx";
DROP INDEX IF EXISTS "Listing_bedrooms_bathrooms_idx";

CREATE INDEX IF NOT EXISTS "Listing_status_createdAt_id_idx"
  ON "Listing"("status", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "Listing_ownerId_status_createdAt_id_idx"
  ON "Listing"("ownerId", "status", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "Listing_status_rent_createdAt_id_idx"
  ON "Listing"("status", "rent", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "Listing_status_bedrooms_bathrooms_createdAt_id_idx"
  ON "Listing"("status", "bedrooms", "bathrooms", "createdAt", "id");

-- Supports the existing case-insensitive `contains` city search on PostgreSQL.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Listing_city_trgm_idx"
  ON "Listing" USING GIN ("city" gin_trgm_ops);
