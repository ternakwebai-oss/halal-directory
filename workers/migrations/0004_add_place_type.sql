-- Halal Directory — add place_type column to places
-- Apply: wrangler d1 migrations apply halal-directory --local

ALTER TABLE places ADD COLUMN place_type TEXT NOT NULL DEFAULT 'restaurant';
