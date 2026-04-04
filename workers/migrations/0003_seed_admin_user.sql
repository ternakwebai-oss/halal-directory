-- Seed default admin user (admin / admin123)
-- Password hash: PBKDF2-SHA256 · 100 000 iterations · 32-byte key
-- Generated offline with Node.js crypto matching the Web Crypto implementation in auth.ts
-- Change this password after first login in any deployed environment.
INSERT OR IGNORE INTO admin_users (username, password_hash)
VALUES (
  'admin',
  '53c83a1ddcfa319f1177983ff3d36959:36448ab5604674dd1bbdcecc4b2e6fe5287b9b36d73aa2d7c8f949fb9386d30d'
);
