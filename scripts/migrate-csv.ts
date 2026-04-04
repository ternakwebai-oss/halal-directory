#!/usr/bin/env ts-node
/**
 * scripts/migrate-csv.ts
 *
 * Reads a CSV export of halal business listings and produces a SQL seed file
 * compatible with `wrangler d1 execute`.
 *
 * Usage:
 *   npx ts-node scripts/migrate-csv.ts input.csv
 *   npx ts-node scripts/migrate-csv.ts input.csv --output scripts/seed-places.sql
 *
 * Expected CSV columns (flexible — see COLUMN_ALIASES below):
 *   name, description, address, city, country, lat, lng,
 *   phone, website, hours, halal_certified, category
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CsvRow {
  [key: string]: string;
}

interface Place {
  name: string;
  description: string | null;
  address: string | null;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  hours: string | null;
  halal_certified: 0 | 1;
  category_slug: string;
}

// ---------------------------------------------------------------------------
// Column aliases — all compared case-insensitively
// ---------------------------------------------------------------------------

const COLUMN_ALIASES: Record<string, string[]> = {
  name:            ['name', 'business_name', 'title', 'listing_name', 'place_name', 'restaurant_name'],
  description:     ['description', 'desc', 'about', 'details', 'info', 'notes'],
  address:         ['address', 'street_address', 'street', 'addr', 'full_address'],
  city:            ['city', 'town', 'locality', 'suburb'],
  country:         ['country', 'country_name', 'nation'],
  lat:             ['lat', 'latitude'],
  lng:             ['lng', 'lon', 'long', 'longitude'],
  phone:           ['phone', 'phone_number', 'tel', 'telephone', 'mobile', 'contact'],
  website:         ['website', 'url', 'web', 'site', 'link'],
  hours:           ['hours', 'opening_hours', 'business_hours', 'open_hours', 'times'],
  halal_certified: ['halal_certified', 'certified', 'halal_cert', 'is_certified', 'certification', 'halal'],
  category:        ['category', 'type', 'category_name', 'kind', 'business_type', 'cuisine'],
};

// Category keyword matching → slug (order matters: more specific first)
const CATEGORY_MAP: Array<[RegExp, string]> = [
  [/butcher|meat\s*shop/i,            'butcher'],
  [/food.?truck|food\s*van|mobile\s*food/i, 'food-truck'],
  [/cafe|coffee|tea\s*house|dessert|ice\s*cream/i, 'cafe'],
  [/bakery|bread|pastry/i,            'bakery'],
  [/cater/i,                          'catering'],
  [/hotel|hostel|lodg|b&b|bed.and.breakfast/i, 'hotel'],
  [/mosque|masjid|islamic\s*cent/i,   'mosque'],
  [/grocery|supermarket|mart|convenience\s*store/i, 'grocery'],
  [/restaurant|diner|eatery|dining|takeaway|take.?out/i, 'restaurant'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mapCategory(raw: string): string {
  if (!raw.trim()) return 'other';
  for (const [pattern, slug] of CATEGORY_MAP) {
    if (pattern.test(raw)) return slug;
  }
  return 'other';
}

function resolveColumn(headers: string[], field: string): string | undefined {
  const aliases = COLUMN_ALIASES[field] ?? [field];
  for (const alias of aliases) {
    const match = headers.find(h => h.toLowerCase().trim() === alias.toLowerCase());
    if (match) return match;
  }
  return undefined;
}

function getField(row: CsvRow, headers: string[], field: string): string {
  const col = resolveColumn(headers, field);
  return col != null ? (row[col] ?? '').trim() : '';
}

function parseNum(s: string): number | null {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** Escape a value for SQL string literal, or return NULL. */
function sqlStr(s: string | null): string {
  if (s === null || s === '') return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// CSV parsing — handles double-quoted fields and embedded commas/newlines
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i <= line.length) {
    if (i === line.length) {
      // trailing empty field after final comma was already pushed
      break;
    }
    if (line[i] === '"') {
      i++;
      let field = '';
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++;
          break;
        } else {
          field += line[i++];
        }
      }
      result.push(field);
      if (line[i] === ',') i++;
    } else {
      let field = '';
      while (i < line.length && line[i] !== ',') {
        field += line[i++];
      }
      result.push(field.trim());
      if (line[i] === ',') i++;
    }
  }
  return result;
}

function parseCsv(content: string): { headers: string[]; rows: CsvRow[] } {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: CsvRow = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? '';
    });
    rows.push(row);
  }
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Slug uniqueness
// ---------------------------------------------------------------------------

const slugCounts = new Map<string, number>();

function uniqueSlug(name: string, city: string): string {
  const base = `${slugify(name)}-${slugify(city)}`;
  const count = slugCounts.get(base) ?? 0;
  slugCounts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------

function buildInsert(p: Place, slug: string): string {
  const categoryExpr = `(SELECT id FROM categories WHERE slug = ${sqlStr(p.category_slug)})`;
  return [
    'INSERT INTO places',
    '  (slug, name, description, address, city, country, lat, lng,',
    '   phone, website, hours, halal_certified, category_id, published)',
    'VALUES (',
    `  ${sqlStr(slug)},`,
    `  ${sqlStr(p.name)},`,
    `  ${sqlStr(p.description)},`,
    `  ${sqlStr(p.address)},`,
    `  ${sqlStr(p.city)},`,
    `  ${sqlStr(p.country)},`,
    `  ${p.lat !== null ? p.lat : 'NULL'},`,
    `  ${p.lng !== null ? p.lng : 'NULL'},`,
    `  ${sqlStr(p.phone)},`,
    `  ${sqlStr(p.website)},`,
    `  ${sqlStr(p.hours)},`,
    `  ${p.halal_certified},`,
    `  ${categoryExpr},`,
    '  1',
    ');',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npx ts-node scripts/migrate-csv.ts <input.csv> [--output <output.sql>]');
    console.log('');
    console.log('Options:');
    console.log('  --output <file>   Output SQL file path (default: scripts/seed-places.sql)');
    process.exit(0);
  }

  const inputFile = args[0];
  const outputIdx = args.indexOf('--output');
  const outputFile = outputIdx !== -1
    ? args[outputIdx + 1]
    : path.join(path.dirname(path.resolve(__filename)), 'seed-places.sql');

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: input file not found: ${inputFile}`);
    process.exit(1);
  }

  const content = fs.readFileSync(inputFile, 'utf-8');
  const { headers, rows } = parseCsv(content);

  if (headers.length === 0) {
    console.error('Error: CSV file is empty or has no headers.');
    process.exit(1);
  }

  console.log(`CSV headers detected: ${headers.join(', ')}`);
  console.log('');

  // Show column mapping
  const fields = ['name', 'description', 'address', 'city', 'country', 'lat', 'lng',
                   'phone', 'website', 'hours', 'halal_certified', 'category'];
  console.log('Column mapping:');
  for (const field of fields) {
    const col = resolveColumn(headers, field);
    const required = field === 'name' || field === 'city';
    const marker = col ? '✓' : (required ? '✗ REQUIRED' : '-');
    console.log(`  ${field.padEnd(16)} → ${col ?? `(not found) ${marker}`}${col ? ` ${marker}` : ''}`);
  }
  console.log('');

  // Validate required columns
  if (!resolveColumn(headers, 'name') || !resolveColumn(headers, 'city')) {
    console.error('Error: CSV must have at least "name" and "city" columns (or recognized aliases).');
    process.exit(1);
  }

  // Process rows
  const seen = new Set<string>(); // dedup key: normalized name|city
  const places: Place[] = [];
  let skippedMissing = 0;
  let skippedDuplicate = 0;

  for (const row of rows) {
    const name = getField(row, headers, 'name');
    const city = getField(row, headers, 'city');

    if (!name || !city) {
      skippedMissing++;
      continue;
    }

    const dedupKey = `${name.toLowerCase()}|${city.toLowerCase()}`;
    if (seen.has(dedupKey)) {
      skippedDuplicate++;
      continue;
    }
    seen.add(dedupKey);

    const rawHalal = getField(row, headers, 'halal_certified').toLowerCase();
    const halal_certified: 0 | 1 =
      rawHalal === 'yes' || rawHalal === '1' || rawHalal === 'true' || rawHalal === 'certified' ? 1 : 0;

    const rawCat = getField(row, headers, 'category');

    places.push({
      name,
      description:     getField(row, headers, 'description') || null,
      address:         getField(row, headers, 'address') || null,
      city,
      country:         getField(row, headers, 'country') || 'Unknown',
      lat:             parseNum(getField(row, headers, 'lat')),
      lng:             parseNum(getField(row, headers, 'lng')),
      phone:           getField(row, headers, 'phone') || null,
      website:         getField(row, headers, 'website') || null,
      hours:           getField(row, headers, 'hours') || null,
      halal_certified,
      category_slug:   mapCategory(rawCat),
    });
  }

  // Build SQL
  const sqlLines: string[] = [
    '-- Generated by scripts/migrate-csv.ts',
    `-- Source: ${path.basename(inputFile)}`,
    `-- Generated: ${new Date().toISOString()}`,
    `-- Records: ${places.length}`,
    '',
    'BEGIN;',
    '',
  ];

  for (const p of places) {
    const slug = uniqueSlug(p.name, p.city);
    sqlLines.push(buildInsert(p, slug));
    sqlLines.push('');
  }

  sqlLines.push('COMMIT;', '');

  const sql = sqlLines.join('\n');

  fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
  fs.writeFileSync(outputFile, sql, 'utf-8');

  const total = rows.length;
  const imported = places.length;
  const skipped = skippedMissing + skippedDuplicate;

  console.log('--- Migration Summary ---');
  console.log(`  Total CSV rows : ${total}`);
  console.log(`  Imported       : ${imported}`);
  console.log(`  Skipped        : ${skipped}`);
  if (skippedMissing > 0)    console.log(`    Missing name/city : ${skippedMissing}`);
  if (skippedDuplicate > 0)  console.log(`    Duplicates        : ${skippedDuplicate}`);
  console.log(`  Output         : ${outputFile}`);
  console.log('');
  console.log('To apply to local D1:');
  console.log(`  wrangler d1 execute halal-directory --local --file ${outputFile}`);
  console.log('');
  console.log('To apply to remote D1:');
  console.log(`  wrangler d1 execute halal-directory --file ${outputFile}`);
}

main();
