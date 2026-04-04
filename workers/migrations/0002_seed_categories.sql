-- Halal Directory — seed initial categories
-- Apply: wrangler d1 migrations apply halal-directory --local

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
