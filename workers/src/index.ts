/**
 * Halal Directory — API Worker
 *
 * Routes (Week 1 skeleton):
 *   GET  /api/health        → liveness check
 *   GET  /api/places        → list / search places (FTS5, Week 4)
 *   GET  /api/places/:slug  → single place detail
 *   POST /api/submit        → public submission form (Week 4)
 *
 * Auth routes (Week 2/3):
 *   POST /api/admin/login
 *   POST /api/admin/logout
 */

import { AutoRouter } from 'itty-router';

export interface Env {
  DB: D1Database;
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
  ADMIN_SESSION_SECRET: string;
}

const router = AutoRouter();

router.get('/api/health', () => {
  return Response.json({ ok: true, ts: Date.now() });
});

router.get('/api/places', async (request, env: Env) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') ?? '';
  const country = url.searchParams.get('country') ?? '';
  const category = url.searchParams.get('category') ?? '';
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = `
    SELECT p.id, p.slug, p.name, p.city, p.country, p.halal_certified,
           c.name AS category_name, c.slug AS category_slug
    FROM places p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.published = 1
  `;
  const params: (string | number)[] = [];

  if (q) {
    query += ` AND (p.name LIKE ? OR p.description LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  if (country) {
    query += ` AND p.country = ?`;
    params.push(country);
  }
  if (category) {
    query += ` AND c.slug = ?`;
    params.push(category);
  }

  query += ` ORDER BY p.name LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...params).all();
  return Response.json({ places: results, page, limit });
});

router.get('/api/places/:slug', async ({ params }, env: Env) => {
  const place = await env.DB.prepare(`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug
    FROM places p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.slug = ? AND p.published = 1
  `).bind(params.slug).first();

  if (!place) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const photos = await env.DB.prepare(
    `SELECT cloudinary_public_id, caption FROM photos WHERE place_id = ? ORDER BY sort_order`
  ).bind(place.id).all();

  return Response.json({ place, photos: photos.results });
});

router.all('*', () => Response.json({ error: 'Not found' }, { status: 404 }));

export default {
  fetch: router.fetch,
} satisfies ExportedHandler<Env>;
