-- Halal Directory — D1 initial schema
-- Apply: wrangler d1 execute halal-directory --file=migrations/0001_initial_schema.sql

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS places (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT    NOT NULL UNIQUE,
  name             TEXT    NOT NULL,
  description      TEXT,
  address          TEXT,
  city             TEXT    NOT NULL,
  country          TEXT    NOT NULL,
  lat              REAL,
  lng              REAL,
  phone            TEXT,
  website          TEXT,
  hours            TEXT,   -- JSON string: { "mon": "09:00-22:00", ... }
  halal_certified  INTEGER NOT NULL DEFAULT 0,  -- boolean
  category_id      INTEGER REFERENCES categories(id),
  published        INTEGER NOT NULL DEFAULT 0,  -- boolean
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_places_country    ON places(country);
CREATE INDEX IF NOT EXISTS idx_places_category   ON places(category_id);
CREATE INDEX IF NOT EXISTS idx_places_published  ON places(published);

-- Full-text search (FTS5) — Week 4 upgrade
-- CREATE VIRTUAL TABLE places_fts USING fts5(name, description, city, content='places', content_rowid='id');

CREATE TABLE IF NOT EXISTS photos (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  place_id             INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  cloudinary_public_id TEXT    NOT NULL,
  caption              TEXT,
  sort_order           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS submissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  description    TEXT,
  address        TEXT,
  city           TEXT NOT NULL,
  country        TEXT NOT NULL,
  phone          TEXT,
  category_id    INTEGER REFERENCES categories(id),
  submitter_email TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT    PRIMARY KEY,  -- UUID
  user_id     INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,
  scopes     TEXT NOT NULL DEFAULT 'read',  -- comma-separated: read,write
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed categories
INSERT OR IGNORE INTO categories (slug, name) VALUES
  ('restaurant',   'Restaurant'),
  ('cafe',         'Café'),
  ('butcher',      'Butcher / Meat Shop'),
  ('grocery',      'Grocery / Supermarket'),
  ('bakery',       'Bakery'),
  ('food-truck',   'Food Truck'),
  ('catering',     'Catering'),
  ('hotel',        'Hotel'),
  ('mosque',       'Mosque'),
  ('other',        'Other');
