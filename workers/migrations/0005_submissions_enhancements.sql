-- Migration: add website, place_type, and rejection_note to submissions
-- Apply: wrangler d1 migrations apply halal-directory --local

ALTER TABLE submissions ADD COLUMN website TEXT;
ALTER TABLE submissions ADD COLUMN place_type TEXT NOT NULL DEFAULT 'restaurant';
ALTER TABLE submissions ADD COLUMN rejection_note TEXT;
