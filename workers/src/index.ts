/**
 * Halal Directory — API Worker
 *
 * Public routes:
 *   GET  /api/health            → liveness check
 *   GET  /api/places            → list / search places
 *   GET  /api/places/:slug      → single place detail
 *   POST /api/submit            → public listing submission form (with Turnstile)
 *   POST /api/submissions       → public listing submission form (legacy, no Turnstile)
 *
 * Auth routes (session):
 *   POST /api/auth/login        → username+password → set session cookie
 *   POST /api/auth/logout       → clear session
 *   GET  /api/auth/me           → current admin user
 *
 * Protected place routes (admin session OR api-key with write scope):
 *   POST   /api/places          → create place
 *   PATCH  /api/places/:id      → update place
 *   DELETE /api/places/:id      → delete place (admin session only)
 *
 * Admin HTML routes — API Keys:
 *   GET  /admin/api-keys         → list keys
 *   GET  /admin/api-keys/new     → create form
 *   POST /admin/api-keys/new     → create key (shows raw key once)
 *   POST /admin/api-keys/:id/revoke → revoke (delete) key
 */

import { AutoRouter } from 'itty-router';
import {
  type AuthedRequest,
  authMiddleware,
  generateToken,
  hashToken,
  hashPassword,
  requireAuth,
  verifyPassword,
} from './auth';
import {
  adminAuthMiddleware,
  handleAdminDashboard,
  handleAdminLoginPage,
  handleAdminLoginSubmit,
  handleAdminLogout,
  handleAdminPhotoDelete,
  handleAdminPhotoMoveDown,
  handleAdminPhotoMoveUp,
  handleAdminPhotoUpload,
  handleAdminPlaceCreate,
  handleAdminPlaceDelete,
  handleAdminPlaceDeleteConfirm,
  handleAdminPlaceEdit,
  handleAdminPlaceNew,
  handleAdminPlacesList,
  handleAdminPlaceTogglePublished,
  handleAdminPlaceUpdate,
  handleAdminSubmissionsList,
  handleAdminSubmissionView,
  handleAdminSubmissionApprove,
  handleAdminSubmissionReject,
  handleAdminUserCreate,
  handleAdminUserDelete,
  handleAdminUserNew,
  handleAdminUsers,
  handleAdminApiKeysList,
  handleAdminApiKeyNew,
  handleAdminApiKeyCreate,
  handleAdminApiKeyRevoke,
  handleAdminChangePasswordPage,
  handleAdminChangePasswordSubmit,
} from './admin';

export interface Env {
  DB: D1Database;
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
  ADMIN_SESSION_SECRET: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
}

const SESSION_DURATION_DAYS = 7;

const router = AutoRouter();

// ---------------------------------------------------------------------------
// Attach auth context to every request
// ---------------------------------------------------------------------------
router.all('*', authMiddleware);

// ---------------------------------------------------------------------------
// Admin auth middleware — redirects unauthenticated /admin/* to /admin/login
// ---------------------------------------------------------------------------
router.all('/admin/*', adminAuthMiddleware);

// ---------------------------------------------------------------------------
// Admin HTML routes — Login / Logout / Dashboard
// ---------------------------------------------------------------------------
router.get('/admin/login', handleAdminLoginPage);
router.post('/admin/login', handleAdminLoginSubmit);
router.get('/admin/logout', handleAdminLogout);
router.get('/admin', handleAdminDashboard);

// ---------------------------------------------------------------------------
// Admin HTML routes — Places CRUD
// Note: /admin/places/new must be registered before /admin/places/:id/edit
// ---------------------------------------------------------------------------
router.get('/admin/places', handleAdminPlacesList);
router.get('/admin/places/new', handleAdminPlaceNew);
router.post('/admin/places/new', handleAdminPlaceCreate);
router.get('/admin/places/:id/edit', handleAdminPlaceEdit);
router.post('/admin/places/:id/edit', handleAdminPlaceUpdate);
router.get('/admin/places/:id/delete', handleAdminPlaceDeleteConfirm);
router.post('/admin/places/:id/delete', handleAdminPlaceDelete);
router.post('/admin/places/:id/toggle-published', handleAdminPlaceTogglePublished);

// ---------------------------------------------------------------------------
// Admin HTML routes — Photo management
// Note: /admin/places/:id/photos/upload must be before /:id/photos/:photoId/*
// ---------------------------------------------------------------------------
router.post('/admin/places/:id/photos/upload', handleAdminPhotoUpload);
router.post('/admin/places/:id/photos/:photoId/delete', handleAdminPhotoDelete);
router.post('/admin/places/:id/photos/:photoId/up', handleAdminPhotoMoveUp);
router.post('/admin/places/:id/photos/:photoId/down', handleAdminPhotoMoveDown);

// ---------------------------------------------------------------------------
// Admin HTML routes — Submissions review queue
// Note: /admin/submissions/:id routes before /admin/submissions
// ---------------------------------------------------------------------------
router.get('/admin/submissions', handleAdminSubmissionsList);
router.get('/admin/submissions/:id', handleAdminSubmissionView);
router.post('/admin/submissions/:id/approve', handleAdminSubmissionApprove);
router.post('/admin/submissions/:id/reject', handleAdminSubmissionReject);

// ---------------------------------------------------------------------------
// Admin HTML routes — Users
// Note: /admin/users/new must be registered before /admin/users/:id/delete
// ---------------------------------------------------------------------------
router.get('/admin/users', handleAdminUsers);
router.get('/admin/users/new', handleAdminUserNew);
router.post('/admin/users/new', handleAdminUserCreate);
router.post('/admin/users/:id/delete', handleAdminUserDelete);

// ---------------------------------------------------------------------------
// Admin HTML routes — Change own password
// ---------------------------------------------------------------------------
router.get('/admin/profile/change-password', handleAdminChangePasswordPage);
router.post('/admin/profile/change-password', handleAdminChangePasswordSubmit);

// ---------------------------------------------------------------------------
// Admin HTML routes — API Keys
// Note: /admin/api-keys/new must be registered before /admin/api-keys/:id/revoke
// ---------------------------------------------------------------------------
router.get('/admin/api-keys', handleAdminApiKeysList);
router.get('/admin/api-keys/new', handleAdminApiKeyNew);
router.post('/admin/api-keys/new', handleAdminApiKeyCreate);
router.post('/admin/api-keys/:id/revoke', handleAdminApiKeyRevoke);

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
router.get('/api/health', () => Response.json({ ok: true, ts: Date.now() }));

// ---------------------------------------------------------------------------
// Auth — login
// ---------------------------------------------------------------------------
router.post('/api/auth/login', async (request, env: Env) => {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { username, password } = body ?? {};
  if (!username || !password) {
    return Response.json(
      { error: 'username and password required' },
      { status: 400 },
    );
  }

  const user = await env.DB.prepare(
    `SELECT id, password_hash FROM admin_users WHERE username = ?`,
  )
    .bind(username)
    .first<{ id: number; password_hash: string }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), user.id, tokenHash, expiresAt)
    .run();

  await env.DB.prepare(
    `UPDATE admin_users SET last_login = datetime('now') WHERE id = ?`,
  )
    .bind(user.id)
    .run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION_DAYS * 86400}`,
    },
  });
});

// ---------------------------------------------------------------------------
// Auth — logout
// ---------------------------------------------------------------------------
router.post('/api/auth/logout', async (request, env: Env) => {
  const cookie = request.headers.get('Cookie');
  const match = cookie?.match(/(?:^|;\s*)session=([^;]+)/);
  if (match?.[1]) {
    const tokenHash = await hashToken(match[1]);
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`)
      .bind(tokenHash)
      .run();
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    },
  });
});

// ---------------------------------------------------------------------------
// Auth — me (session only)
// ---------------------------------------------------------------------------
router.get('/api/auth/me', async (request, env: Env) => {
  const req = request as AuthedRequest;
  const guard = requireAuth(false)(req);
  if (guard) return guard;

  const { userId } = req.auth!;
  const user = await env.DB.prepare(
    `SELECT id, username, created_at, last_login FROM admin_users WHERE id = ?`,
  )
    .bind(userId)
    .first();

  if (!user) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ user });
});

// ---------------------------------------------------------------------------
// Places — public list/search
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Places — public single
// ---------------------------------------------------------------------------
router.get('/api/places/:slug', async ({ params }, env: Env) => {
  const place = await env.DB.prepare(
    `SELECT p.*, c.name AS category_name, c.slug AS category_slug
     FROM places p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.slug = ? AND p.published = 1`,
  )
    .bind(params.slug)
    .first();

  if (!place) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  const photos = await env.DB.prepare(
    `SELECT cloudinary_public_id, caption FROM photos WHERE place_id = ? ORDER BY sort_order`,
  )
    .bind((place as { id: number }).id)
    .all();

  return Response.json({ place, photos: photos.results });
});

// ---------------------------------------------------------------------------
// Places — create (admin session OR api-key write)
// ---------------------------------------------------------------------------
router.post('/api/places', async (request, env: Env) => {
  const guard = requireAuth(true)(request as AuthedRequest);
  if (guard) return guard;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = String(body.name ?? '').trim();
  const slug = String(body.slug ?? '').trim();
  const city = String(body.city ?? '').trim();
  const country = String(body.country ?? '').trim();

  if (!name || !slug || !city || !country) {
    return Response.json(
      { error: 'name, slug, city, and country are required' },
      { status: 400 },
    );
  }

  const existing = await env.DB.prepare(`SELECT id FROM places WHERE slug = ?`)
    .bind(slug)
    .first<{ id: number }>();
  if (existing) {
    return Response.json({ error: `Slug "${slug}" is already taken` }, { status: 409 });
  }

  const place_type = String(body.place_type ?? 'restaurant');
  const description = body.description ? String(body.description).trim() : null;
  const category_id = body.category_id ? Number(body.category_id) : null;
  const address = body.address ? String(body.address).trim() : null;
  const lat = body.lat != null ? Number(body.lat) : null;
  const lng = body.lng != null ? Number(body.lng) : null;
  const phone = body.phone ? String(body.phone).trim() : null;
  const website = body.website ? String(body.website).trim() : null;
  const hours = body.hours ? String(body.hours).trim() : null;
  const halal_certified = body.halal_certified ? 1 : 0;
  const published = body.published ? 1 : 0;

  const result = await env.DB.prepare(
    `INSERT INTO places
       (slug, name, description, place_type, category_id, address, city, country,
        lat, lng, phone, website, hours, halal_certified, published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      slug, name, description, place_type, category_id,
      address, city, country, lat, lng, phone, website, hours,
      halal_certified, published,
    )
    .run();

  return Response.json({ ok: true, id: result.meta.last_row_id }, { status: 201 });
});

// ---------------------------------------------------------------------------
// Places — update (admin session OR api-key write)
// ---------------------------------------------------------------------------
router.patch('/api/places/:id', async (request, env: Env) => {
  const guard = requireAuth(true)(request as AuthedRequest);
  if (guard) return guard;

  const id = Number(request.params?.id);
  if (!id) return Response.json({ error: 'Invalid id' }, { status: 400 });

  const place = await env.DB.prepare(`SELECT * FROM places WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (!place) return Response.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Merge incoming fields over existing values
  const slug = body.slug != null ? String(body.slug).trim() : String(place.slug);
  const name = body.name != null ? String(body.name).trim() : String(place.name);
  const city = body.city != null ? String(body.city).trim() : String(place.city);
  const country = body.country != null ? String(body.country).trim() : String(place.country);

  if (!name || !slug || !city || !country) {
    return Response.json({ error: 'name, slug, city, and country cannot be blank' }, { status: 400 });
  }

  // Check slug uniqueness if it changed
  if (slug !== place.slug) {
    const conflict = await env.DB.prepare(`SELECT id FROM places WHERE slug = ? AND id != ?`)
      .bind(slug, id)
      .first<{ id: number }>();
    if (conflict) {
      return Response.json({ error: `Slug "${slug}" is already taken` }, { status: 409 });
    }
  }

  const place_type = body.place_type != null ? String(body.place_type) : String(place.place_type ?? 'restaurant');
  const description = body.description != null ? (String(body.description).trim() || null) : place.description;
  const category_id = body.category_id != null ? (body.category_id ? Number(body.category_id) : null) : place.category_id;
  const address = body.address != null ? (String(body.address).trim() || null) : place.address;
  const lat = body.lat != null ? Number(body.lat) : place.lat;
  const lng = body.lng != null ? Number(body.lng) : place.lng;
  const phone = body.phone != null ? (String(body.phone).trim() || null) : place.phone;
  const website = body.website != null ? (String(body.website).trim() || null) : place.website;
  const hours = body.hours != null ? (String(body.hours).trim() || null) : place.hours;
  const halal_certified = body.halal_certified != null ? (body.halal_certified ? 1 : 0) : place.halal_certified;
  const published = body.published != null ? (body.published ? 1 : 0) : place.published;

  await env.DB.prepare(
    `UPDATE places SET
       name=?, slug=?, description=?, place_type=?, category_id=?,
       address=?, city=?, country=?, lat=?, lng=?, phone=?, website=?,
       hours=?, halal_certified=?, published=?
     WHERE id=?`,
  )
    .bind(
      name, slug, description, place_type, category_id,
      address, city, country, lat, lng, phone, website, hours,
      halal_certified, published, id,
    )
    .run();

  return Response.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Places — delete (admin session only)
// ---------------------------------------------------------------------------
router.delete('/api/places/:id', async (request, env: Env) => {
  const guard = requireAuth(false)(request as AuthedRequest);
  if (guard) return guard;

  const id = Number(request.params?.id);
  if (!id) return Response.json({ error: 'Invalid id' }, { status: 400 });

  const place = await env.DB.prepare(`SELECT id FROM places WHERE id = ?`)
    .bind(id)
    .first<{ id: number }>();
  if (!place) return Response.json({ error: 'Not found' }, { status: 404 });

  await env.DB.prepare(`DELETE FROM places WHERE id = ?`).bind(id).run();

  return Response.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Submit — public listing submission form with Turnstile validation
// ---------------------------------------------------------------------------
router.post('/api/submit', async (request, env: Env) => {
  let body: {
    name?: string;
    description?: string;
    address?: string;
    city?: string;
    country?: string;
    phone?: string;
    website?: string;
    place_type?: string;
    category_id?: number | string;
    submitter_email?: string;
    turnstile_token?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name, city, country, turnstile_token } = body ?? {};
  if (!name || !city || !country) {
    return Response.json(
      { error: 'name, city, and country are required' },
      { status: 400 },
    );
  }

  // Validate Turnstile token (skip if secret key not configured, e.g. local dev)
  if (env.TURNSTILE_SECRET_KEY) {
    if (!turnstile_token) {
      return Response.json({ error: 'Turnstile token is required' }, { status: 400 });
    }
    const ip = request.headers.get('CF-Connecting-IP') ?? '';
    const verifyForm = new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: turnstile_token,
      remoteip: ip,
    });
    const verifyRes = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: verifyForm },
    );
    const verifyData = (await verifyRes.json()) as { success: boolean; 'error-codes'?: string[] };
    if (!verifyData.success) {
      return Response.json({ error: 'Turnstile verification failed. Please try again.' }, { status: 400 });
    }
  }

  const place_type = body.place_type === 'prayer' ? 'prayer' : 'restaurant';
  const category_id = body.category_id ? Number(body.category_id) : null;

  await env.DB.prepare(
    `INSERT INTO submissions
       (name, description, address, city, country, phone, website, place_type, category_id, submitter_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      name,
      body.description ?? null,
      body.address ?? null,
      city,
      country,
      body.phone ?? null,
      body.website ?? null,
      place_type,
      category_id,
      body.submitter_email ?? null,
    )
    .run();

  return Response.json({ ok: true }, { status: 201 });
});

// ---------------------------------------------------------------------------
// Submissions — public (legacy, no Turnstile)
// ---------------------------------------------------------------------------
router.post('/api/submissions', async (request, env: Env) => {
  let body: {
    name?: string;
    description?: string;
    address?: string;
    city?: string;
    country?: string;
    phone?: string;
    category_id?: number;
    submitter_email?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name, city, country } = body ?? {};
  if (!name || !city || !country) {
    return Response.json(
      { error: 'name, city, and country are required' },
      { status: 400 },
    );
  }

  await env.DB.prepare(
    `INSERT INTO submissions (name, description, address, city, country, phone, category_id, submitter_email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      name,
      body.description ?? null,
      body.address ?? null,
      city,
      country,
      body.phone ?? null,
      body.category_id ?? null,
      body.submitter_email ?? null,
    )
    .run();

  return Response.json({ ok: true }, { status: 201 });
});

// ---------------------------------------------------------------------------
// Map data — public, returns all published places with coordinates
// ---------------------------------------------------------------------------
router.get('/api/map-data', async (_request, env: Env) => {
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.name, p.lat, p.lng, p.place_type, p.slug,
           c.name AS category
    FROM places p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.published = 1 AND p.lat IS NOT NULL AND p.lng IS NOT NULL
  `).all();
  return Response.json({ places: results });
});

// ---------------------------------------------------------------------------
// Search — FTS5 full-text search
// GET /api/search?q=&type=restaurant|prayer|all&country=&limit=20
// ---------------------------------------------------------------------------
router.get('/api/search', async (request, env: Env) => {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const type = url.searchParams.get('type') ?? 'all';
  const country = url.searchParams.get('country') ?? '';
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));

  if (!q) {
    return Response.json({ results: [] });
  }

  // Wrap in quotes for phrase-friendly search; escape embedded quotes
  const ftsQuery = `"${q.replace(/"/g, '""')}"`;

  let sql = `
    SELECT p.id, p.slug, p.name, p.place_type, p.city, p.country,
           c.name AS category,
           snippet(places_fts, 1, '<mark>', '</mark>', '…', 20) AS description_snippet
    FROM places_fts
    JOIN places p ON p.id = places_fts.rowid
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE places_fts MATCH ? AND p.published = 1
  `;
  const params: (string | number)[] = [ftsQuery];

  if (type === 'restaurant' || type === 'prayer') {
    sql += ` AND p.place_type = ?`;
    params.push(type);
  }
  if (country) {
    sql += ` AND p.country = ?`;
    params.push(country);
  }

  sql += ` ORDER BY rank LIMIT ?`;
  params.push(limit);

  try {
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    return Response.json({ results });
  } catch {
    // FTS5 syntax errors (e.g. empty query after sanitisation) → empty results
    return Response.json({ results: [] });
  }
});

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------
router.all('*', () => Response.json({ error: 'Not found' }, { status: 404 }));

export default {
  fetch: router.fetch,
} satisfies ExportedHandler<Env>;
