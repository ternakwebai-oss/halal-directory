import type { APIRoute } from 'astro';

const SITE = 'https://halal.nusba.com';

interface PlaceRow {
  slug: string;
  updated_at: string | null;
}

interface CategoryRow {
  slug: string;
}

interface CountryCityRow {
  country: string;
  city: string;
}

function toSlug(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function url(
  loc: string,
  opts: { lastmod?: string; changefreq?: string; priority?: string } = {}
): string {
  const parts = [`  <url>\n    <loc>${escapeXml(loc)}</loc>`];
  if (opts.lastmod) parts.push(`\n    <lastmod>${opts.lastmod.slice(0, 10)}</lastmod>`);
  if (opts.changefreq) parts.push(`\n    <changefreq>${opts.changefreq}</changefreq>`);
  if (opts.priority) parts.push(`\n    <priority>${opts.priority}</priority>`);
  parts.push('\n  </url>');
  return parts.join('');
}

export const GET: APIRoute = async ({ locals }) => {
  const runtime = (locals as Record<string, unknown>).runtime as
    | { env?: Record<string, unknown> }
    | undefined;
  const db = runtime?.env?.DB as D1Database | undefined;

  const entries: string[] = [];

  // Homepage
  entries.push(url(`${SITE}/`, { changefreq: 'daily', priority: '1.0' }));

  // Static index pages
  entries.push(url(`${SITE}/categories`, { changefreq: 'daily', priority: '0.9' }));
  entries.push(url(`${SITE}/countries`, { changefreq: 'daily', priority: '0.9' }));

  if (db) {
    // All published listing detail pages
    const placesResult = await db
      .prepare(
        `SELECT slug, updated_at FROM places WHERE published = 1 ORDER BY slug ASC`
      )
      .all<PlaceRow>();

    for (const place of placesResult.results) {
      entries.push(
        url(`${SITE}/places/${escapeXml(place.slug)}`, {
          lastmod: place.updated_at ?? undefined,
          changefreq: 'weekly',
          priority: '0.8',
        })
      );
    }

    // Category pages
    const catResult = await db
      .prepare(`SELECT slug FROM categories ORDER BY slug ASC`)
      .all<CategoryRow>();

    for (const cat of catResult.results) {
      entries.push(
        url(`${SITE}/categories/${escapeXml(cat.slug)}`, {
          changefreq: 'daily',
          priority: '0.9',
        })
      );
    }

    // Country + city pages
    const countryCityResult = await db
      .prepare(
        `SELECT DISTINCT country, city FROM places WHERE published = 1 ORDER BY country ASC, city ASC`
      )
      .all<CountryCityRow>();

    const countries = new Set<string>();
    for (const row of countryCityResult.results) {
      const countrySlug = toSlug(row.country);
      const citySlug = toSlug(row.city);

      if (!countries.has(countrySlug)) {
        countries.add(countrySlug);
        entries.push(
          url(`${SITE}/countries/${escapeXml(countrySlug)}`, {
            changefreq: 'daily',
            priority: '0.9',
          })
        );
      }

      entries.push(
        url(`${SITE}/countries/${escapeXml(countrySlug)}/${escapeXml(citySlug)}`, {
          changefreq: 'daily',
          priority: '0.9',
        })
      );
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
};
