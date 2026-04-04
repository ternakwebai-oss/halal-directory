/**
 * Halal Directory — API Worker
 *
 * Public routes:
 *   GET  /api/health            → liveness check
 *   GET  /api/places            → list / search places
 *   GET  /api/places/:slug      → single place detail
 *   POST /api/submissions       → public listing submission form
 *
 * Auth routes (session):
 *   POST /api/auth/login        → username+password → set session cookie
 *   POST /api/auth/logout       → clear session
 *   GET  /api/auth/me           → current admin user
 *
 * Protected place routes (admin session OR api-key with write scope):
 *   POST   /api/places          → create place (admin | api-key write)
 *   PATCH  /api/places/:id      → update place  (admin | api-key write)
 *   DELETE /api/places/:id      → delete place  (admin session only)
 */

import { AutoRouter } from 'itty-router';
import {
  type AuthedRequest,
  authMiddleware,
  generateToken,
  hashToken,
  requireAuth,
  verifyPassword,
} from './auth';
import {
  adminAuthMiddleware,
  handleAdminDashboard,
  handleAdminLoginPage,
  handleAdminLoginSubmit,
  handleAdminLogout,
  handleAdminPlaces,
  handleAdminUsers,
} from './admin';

export interface Env {
  DB: D1Database;
  CLOUDINARY_CLOUD_NAME: string;
  CLOUDINARY_API_KEY: string;
  CLOUDINARY_API_SECRET: string;
  ADMIN_SESSION_SECRET: string;
}

const SESSION_DURATION_DAYS = 7;

const router = AutoRouter();

// ---------------------------------------------------------------------------
// Attach auth context to every request
// ---------------------------------------------------------------------------
router.all('*', authMiddleware);

// ---------------------------------------------------------------------------
// Admin auth middleware — redirects unauthenticated /admin/* to /admin/login
// (runs after authMiddleware so session cookie is already parsed)
// ---------------------------------------------------------------------------
router.all('/admin/*', adminAuthMiddleware);

// ---------------------------------------------------------------------------
// Admin HTML routes (server-rendered, no Astro)
// ---------------------------------------------------------------------------
router.get('/admin/login', handleAdminLoginPage);
router.post('/admin/login', handleAdminLoginSubmit);
router.get('/admin/logout', handleAdminLogout);
router.get('/admin', handleAdminDashboard);
router.get('/admin/places', handleAdminPlaces);
router.get('/admin/users', handleAdminUsers);

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

  // Create session token (raw token → cookie, hash → DB)
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

  // TODO (Week 3): full validation + Cloudinary upload
  return Response.json({ error: 'Not yet implemented' }, { status: 501 });
});

// ---------------------------------------------------------------------------
// Places — update (admin session OR api-key write)
// ---------------------------------------------------------------------------
router.patch('/api/places/:id', async (request, env: Env) => {
  const guard = requireAuth(true)(request as AuthedRequest);
  if (guard) return guard;

  // TODO (Week 3): partial update logic
  return Response.json({ error: 'Not yet implemented' }, { status: 501 });
});

// ---------------------------------------------------------------------------
// Places — delete (admin session only)
// ---------------------------------------------------------------------------
router.delete('/api/places/:id', async (request, env: Env) => {
  const guard = requireAuth(false)(request as AuthedRequest);
  if (guard) return guard;

  // TODO (Week 3): soft-delete or hard-delete
  return Response.json({ error: 'Not yet implemented' }, { status: 501 });
});

// ---------------------------------------------------------------------------
// Submissions — public
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
// Fallback
// ---------------------------------------------------------------------------
router.all('*', () => Response.json({ error: 'Not found' }, { status: 404 }));

export default {
  fetch: router.fetch,
} satisfies ExportedHandler<Env>;
