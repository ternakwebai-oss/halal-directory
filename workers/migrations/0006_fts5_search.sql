-- Migration: Rebuild places_fts as standalone FTS5 with category support + auto-sync triggers
-- Apply: wrangler d1 migrations apply halal-directory --local

-- Drop old content-based FTS5 table (was content='places', never populated via triggers)
DROP TABLE IF EXISTS places_fts;

-- Standalone FTS5: rowid = place.id, so we can JOIN back on places.id = fts.rowid
CREATE VIRTUAL TABLE places_fts USING fts5(
  name,
  description,
  category_name,
  city
);

-- Populate from existing published places
INSERT INTO places_fts(rowid, name, description, category_name, city)
SELECT
  p.id,
  p.name,
  COALESCE(p.description, ''),
  COALESCE(c.name, ''),
  p.city
FROM places p
LEFT JOIN categories c ON c.id = p.category_id
WHERE p.published = 1;

-- -------------------------------------------------------------------------
-- Sync triggers — keep FTS index up-to-date when places rows change
-- -------------------------------------------------------------------------

-- After INSERT: add new FTS entry
CREATE TRIGGER places_fts_ai AFTER INSERT ON places BEGIN
  INSERT INTO places_fts(rowid, name, description, category_name, city)
  VALUES (
    NEW.id,
    NEW.name,
    COALESCE(NEW.description, ''),
    COALESCE((SELECT name FROM categories WHERE id = NEW.category_id), ''),
    NEW.city
  );
END;

-- Before UPDATE: remove stale FTS entry
CREATE TRIGGER places_fts_bu BEFORE UPDATE ON places BEGIN
  DELETE FROM places_fts WHERE rowid = OLD.id;
END;

-- After UPDATE: add refreshed FTS entry
CREATE TRIGGER places_fts_au AFTER UPDATE ON places BEGIN
  INSERT INTO places_fts(rowid, name, description, category_name, city)
  VALUES (
    NEW.id,
    NEW.name,
    COALESCE(NEW.description, ''),
    COALESCE((SELECT name FROM categories WHERE id = NEW.category_id), ''),
    NEW.city
  );
END;

-- Before DELETE: remove FTS entry
CREATE TRIGGER places_fts_bd BEFORE DELETE ON places BEGIN
  DELETE FROM places_fts WHERE rowid = OLD.id;
END;
