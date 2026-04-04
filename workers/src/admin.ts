/**
 * Admin panel — server-rendered HTML routes
 *
 * All responses are plain HTML produced by the Worker.
 * No Astro, no frontend framework.
 *
 * Routes wired in index.ts:
 *   GET  /admin/login                         → login form
 *   POST /admin/login                         → process credentials → set cookie → redirect /admin
 *   GET  /admin/logout                        → clear cookie → redirect /admin/login
 *   GET  /admin                               → dashboard (protected)
 *   GET  /admin/places                        → places list with filters + pagination
 *   GET  /admin/places/new                    → create form
 *   POST /admin/places/new                    → create place
 *   GET  /admin/places/:id/edit               → edit form
 *   POST /admin/places/:id/edit               → update place
 *   GET  /admin/places/:id/delete             → delete confirmation
 *   POST /admin/places/:id/delete             → hard delete
 *   POST /admin/places/:id/toggle-published   → toggle published flag
 *   GET  /admin/users                         → users list
 *   GET  /admin/users/new                     → create user form
 *   POST /admin/users/new                     → create user
 *   POST /admin/users/:id/delete              → delete user
 *
 * Auth middleware (adminAuthMiddleware) must run before all /admin/* routes
 * except /admin/login.
 */

import type { IRequest } from 'itty-router';
import type { Env } from './index';
import { generateToken, hashToken, hashPassword, verifyPassword } from './auth';

const SESSION_DURATION_DAYS = 7;
const PLACES_PER_PAGE = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlaceRow {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  place_type: string;
  category_id: number | null;
  address: string | null;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  website: string | null;
  hours: string | null;
  halal_certified: number;
  published: number;
  category_name?: string | null;
  first_photo?: string | null;
}

interface PhotoRow {
  id: number;
  place_id: number;
  cloudinary_public_id: string;
  caption: string | null;
  sort_order: number;
}

interface CategoryRow {
  id: number;
  name: string;
  slug: string;
}

interface AdminUserRow {
  id: number;
  username: string;
  created_at: string;
  last_login: string | null;
}

// ---------------------------------------------------------------------------
// HTML escape helper
// ---------------------------------------------------------------------------

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Cloudinary helpers
// ---------------------------------------------------------------------------

/**
 * Generate a Cloudinary API signature.
 * Signature = SHA-1( "key1=val1&key2=val2..." + apiSecret ) with params sorted.
 */
async function cloudinarySign(
  params: Record<string, string>,
  apiSecret: string,
): Promise<string> {
  const paramStr =
    Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&') + apiSecret;
  const data = new TextEncoder().encode(paramStr);
  const hashBuf = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Build a Cloudinary thumbnail URL (100×100, crop fill). */
function cloudinaryThumb(cloudName: string, publicId: string): string {
  return `https://res.cloudinary.com/${esc(cloudName)}/image/upload/c_fill,w_100,h_100,f_auto,q_auto/${esc(publicId)}`;
}

// ---------------------------------------------------------------------------
// Shared layout / CSS helpers
// ---------------------------------------------------------------------------

function navBar(): string {
  return `
  <nav>
    <a class="brand" href="/admin">Halal Directory</a>
    <a href="/admin/places">Places</a>
    <a href="/admin/submissions">Submissions</a>
    <a href="/admin/users">Users</a>
    <a href="/admin/logout">Logout</a>
  </nav>`;
}

const BASE_STYLES = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #f5f5f5; color: #111; }
  nav {
    background: #1e293b; color: #fff; padding: .75rem 1.5rem;
    display: flex; align-items: center; gap: 1.5rem;
    position: sticky; top: 0; z-index: 10;
  }
  nav a { color: #cbd5e1; text-decoration: none; font-size: .875rem; }
  nav a:hover { color: #fff; }
  nav .brand { font-weight: 600; color: #fff; margin-right: auto; font-size: 1rem; }
  main { max-width: 1200px; margin: 2rem auto; padding: 0 1.5rem 4rem; }
  h1 { font-size: 1.5rem; margin-bottom: 1rem; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .btn {
    display: inline-flex; align-items: center; padding: .45rem .9rem;
    border: none; border-radius: 5px; cursor: pointer; font-size: .875rem;
    font-family: inherit; text-decoration: none; line-height: 1.4; white-space: nowrap;
  }
  .btn:hover { text-decoration: none; }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-primary:hover { background: #1d4ed8; }
  .btn-danger { background: #dc2626; color: #fff; }
  .btn-danger:hover { background: #b91c1c; }
  .btn-secondary { background: #e2e8f0; color: #334155; }
  .btn-secondary:hover { background: #cbd5e1; }
  .btn-sm { padding: .3rem .6rem; font-size: .78rem; }
  .flash-success {
    background: #d1fae5; color: #065f46; padding: .6rem 1rem;
    border-radius: 5px; margin-bottom: 1.25rem; font-size: .875rem;
  }
  .flash-error {
    background: #fee2e2; color: #991b1b; padding: .6rem 1rem;
    border-radius: 5px; margin-bottom: 1.25rem; font-size: .875rem;
  }
  .card {
    background: #fff; border-radius: 8px;
    box-shadow: 0 1px 4px rgba(0,0,0,.08); padding: 1.5rem; margin-bottom: 1.5rem;
  }
`;

const FORM_STYLES = `
  .form-group { margin-bottom: 1rem; }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; }
  label { display: block; font-size: .875rem; font-weight: 500; margin-bottom: .3rem; color: #374151; }
  input[type=text], input[type=url], input[type=tel],
  input[type=number], input[type=password], select, textarea {
    display: block; width: 100%; padding: .5rem .75rem;
    border: 1px solid #d1d5db; border-radius: 5px;
    font-size: .9rem; font-family: inherit; background: #fff;
  }
  input:focus, select:focus, textarea:focus {
    outline: 2px solid #2563eb; border-color: transparent;
  }
  textarea { min-height: 80px; resize: vertical; }
  .hint { font-size: .78rem; color: #6b7280; margin-top: .2rem; }
  .check-group { display: flex; align-items: center; gap: .5rem; }
  .check-group input { width: auto; }
  .form-actions { display: flex; gap: .75rem; align-items: center; margin-top: 1.5rem; }
`;

const TABLE_STYLES = `
  .table-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; flex-wrap: wrap; gap: .75rem; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  th {
    text-align: left; padding: .6rem 1rem;
    background: #f8fafc; border-bottom: 2px solid #e2e8f0;
    font-weight: 600; color: #475569; white-space: nowrap;
  }
  td { padding: .6rem 1rem; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f8fafc; }
  .badge { display: inline-block; padding: .2rem .5rem; border-radius: 4px; font-size: .75rem; font-weight: 600; }
  .badge-green { background: #d1fae5; color: #065f46; }
  .badge-gray { background: #f1f5f9; color: #64748b; }
  .badge-blue { background: #dbeafe; color: #1d4ed8; }
  .badge-orange { background: #ffedd5; color: #c2410c; }
  .filters { display: flex; gap: .75rem; align-items: flex-end; flex-wrap: wrap; margin-bottom: 1.25rem; }
  .filters label { font-size: .8rem; }
  .filters select, .filters input[type=text] { padding: .4rem .6rem; font-size: .85rem; }
  .pagination { display: flex; gap: .4rem; align-items: center; margin-top: 1.25rem; font-size: .875rem; }
  .pagination a, .pagination span {
    padding: .35rem .65rem; border: 1px solid #e2e8f0; border-radius: 4px;
    color: #334155; text-decoration: none;
  }
  .pagination a:hover { background: #f1f5f9; text-decoration: none; }
  .pagination .current { background: #2563eb; color: #fff; border-color: #2563eb; }
  .actions { display: flex; gap: .4rem; align-items: center; }
  .empty { text-align: center; padding: 3rem 1rem; color: #94a3b8; }
`;

function page(title: string, body: string, extraStyles = ''): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} — Halal Directory Admin</title>
  <style>${BASE_STYLES}${extraStyles}</style>
</head>
<body>
  ${navBar()}
  <main>${body}</main>
</body>
</html>`;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

function flashHtml(url: URL): string {
  const ok = url.searchParams.get('ok');
  const err = url.searchParams.get('err');
  if (ok) return `<div class="flash-success">${esc(ok)}</div>`;
  if (err) return `<div class="flash-error">${esc(err)}</div>`;
  return '';
}

// ---------------------------------------------------------------------------
// Session cookie helper
// ---------------------------------------------------------------------------

function getSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key === 'session') return val || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Auth middleware (runs before all /admin/* except /admin/login)
// ---------------------------------------------------------------------------

export interface AdminContext {
  id: number;
  username: string;
}

export type AdminRequest = IRequest & { adminUser?: AdminContext };

/**
 * Middleware for all /admin/* routes.
 * - Skips /admin/login (would cause redirect loop).
 * - Validates session cookie; unauthenticated → 302 /admin/login.
 * - Attaches `adminUser` to the request on success.
 */
export async function adminAuthMiddleware(
  request: IRequest,
  env: Env,
): Promise<Response | void> {
  const url = new URL((request as Request).url);
  if (!url.pathname.startsWith('/admin')) return;
  if (url.pathname === '/admin/login') return;

  const sessionToken = getSessionCookie(
    (request as Request).headers.get('Cookie'),
  );
  if (!sessionToken) {
    return Response.redirect('/admin/login', 302);
  }

  const tokenHash = await hashToken(sessionToken);
  const row = await env.DB.prepare(
    `SELECT s.user_id AS id, u.username
     FROM sessions s
     JOIN admin_users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
  )
    .bind(tokenHash)
    .first<{ id: number; username: string }>();

  if (!row) {
    return Response.redirect('/admin/login', 302);
  }

  (request as AdminRequest).adminUser = { id: row.id, username: row.username };
}

// ---------------------------------------------------------------------------
// Login page
// ---------------------------------------------------------------------------

function loginPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login — Halal Directory</title>
  <style>
    ${BASE_STYLES}
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card {
      background: #fff; padding: 2rem; border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.1); width: 100%; max-width: 360px;
    }
    h1 { font-size: 1.25rem; margin-bottom: 1.5rem; }
    label { display: block; font-size: .875rem; font-weight: 500; margin-bottom: .25rem; color: #333; }
    input {
      display: block; width: 100%; padding: .5rem .75rem;
      border: 1px solid #ccc; border-radius: 4px; font-size: 1rem; margin-bottom: 1rem;
    }
    input:focus { outline: 2px solid #2563eb; border-color: transparent; }
    button {
      width: 100%; padding: .625rem; background: #2563eb; color: #fff;
      border: none; border-radius: 4px; font-size: 1rem; cursor: pointer;
    }
    button:hover { background: #1d4ed8; }
    .error {
      background: #fee2e2; color: #991b1b; padding: .5rem .75rem;
      border-radius: 4px; font-size: .875rem; margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Halal Directory Admin</h1>
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <form method="POST" action="/admin/login">
      <label for="username">Username</label>
      <input type="text" id="username" name="username" required autocomplete="username">
      <label for="password">Password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function dashboardPage(username: string): string {
  return page(
    'Dashboard',
    `<h1>Admin Dashboard</h1>
    <p style="color:#555;margin-bottom:1.5rem">Welcome, ${esc(username)}.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem">
      <a class="card" href="/admin/places" style="display:block;text-decoration:none;color:#111">
        <h2 style="font-size:1rem;margin-bottom:.25rem">Places</h2>
        <p style="font-size:.8rem;color:#666">Manage listings</p>
      </a>
      <a class="card" href="/admin/submissions" style="display:block;text-decoration:none;color:#111">
        <h2 style="font-size:1rem;margin-bottom:.25rem">Submissions</h2>
        <p style="font-size:.8rem;color:#666">Review public submissions</p>
      </a>
      <a class="card" href="/admin/users" style="display:block;text-decoration:none;color:#111">
        <h2 style="font-size:1rem;margin-bottom:.25rem">Users</h2>
        <p style="font-size:.8rem;color:#666">Manage admin users</p>
      </a>
    </div>`,
  );
}

// ---------------------------------------------------------------------------
// Route handlers — Login / Logout / Dashboard
// ---------------------------------------------------------------------------

/** GET /admin/login */
export function handleAdminLoginPage(_request: IRequest): Response {
  return html(loginPage());
}

/** POST /admin/login */
export async function handleAdminLoginSubmit(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const req = request as Request;
  const contentType = req.headers.get('Content-Type') ?? '';

  let username = '';
  let password = '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    const params = new URLSearchParams(text);
    username = params.get('username') ?? '';
    password = params.get('password') ?? '';
  }

  if (!username || !password) {
    return html(loginPage('Username and password are required'), 400);
  }

  const user = await env.DB.prepare(
    `SELECT id, password_hash FROM admin_users WHERE username = ?`,
  )
    .bind(username)
    .first<{ id: number; password_hash: string }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return html(loginPage('Invalid username or password'), 401);
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

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin',
      'Set-Cookie': `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION_DAYS * 86400}`,
    },
  });
}

/** GET /admin/logout */
export async function handleAdminLogout(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const sessionToken = getSessionCookie(
    (request as Request).headers.get('Cookie'),
  );
  if (sessionToken) {
    const tokenHash = await hashToken(sessionToken);
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`)
      .bind(tokenHash)
      .run();
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/admin/login',
      'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    },
  });
}

/** GET /admin */
export function handleAdminDashboard(request: IRequest): Response {
  const username = (request as AdminRequest).adminUser?.username ?? 'Admin';
  return html(dashboardPage(username));
}

// ---------------------------------------------------------------------------
// Helpers — place form rendering
// ---------------------------------------------------------------------------

function placeFormBody(
  formAction: string,
  values: Partial<PlaceRow>,
  categories: CategoryRow[],
  error?: string,
): string {
  const v = values;
  const checked = (val: number | undefined | null) =>
    val ? 'checked' : '';

  const categoryOptions = categories
    .map(
      (c) =>
        `<option value="${c.id}" ${v.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`,
    )
    .join('');

  const isEdit = Boolean(v.id);

  return `
    ${error ? `<div class="flash-error">${esc(error)}</div>` : ''}
    <form method="POST" action="${esc(formAction)}">
      <div class="form-row">
        <div class="form-group">
          <label for="name">Name *</label>
          <input type="text" id="name" name="name" value="${esc(v.name)}" required>
        </div>
        <div class="form-group">
          <label for="slug">Slug *</label>
          <input type="text" id="slug" name="slug" value="${esc(v.slug)}" required>
          <div class="hint">URL-safe identifier. Auto-generated from name.</div>
        </div>
      </div>

      <div class="form-group">
        <label for="description">Description</label>
        <textarea id="description" name="description">${esc(v.description)}</textarea>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="place_type">Place Type *</label>
          <select id="place_type" name="place_type" required>
            <option value="restaurant" ${v.place_type === 'restaurant' || !v.place_type ? 'selected' : ''}>Restaurant / Food</option>
            <option value="prayer" ${v.place_type === 'prayer' ? 'selected' : ''}>Prayer Place (Mosque / Prayer Room)</option>
          </select>
        </div>
        <div class="form-group">
          <label for="category_id">Category</label>
          <select id="category_id" name="category_id">
            <option value="">— None —</option>
            ${categoryOptions}
          </select>
        </div>
      </div>

      <div class="form-group">
        <label for="address">Address</label>
        <input type="text" id="address" name="address" value="${esc(v.address)}">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="city">City *</label>
          <input type="text" id="city" name="city" value="${esc(v.city)}" required>
        </div>
        <div class="form-group">
          <label for="country">Country *</label>
          <input type="text" id="country" name="country" value="${esc(v.country)}" required>
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="lat">Latitude</label>
          <input type="number" id="lat" name="lat" step="any" value="${v.lat ?? ''}">
        </div>
        <div class="form-group">
          <label for="lng">Longitude</label>
          <input type="number" id="lng" name="lng" step="any" value="${v.lng ?? ''}">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="phone">Phone</label>
          <input type="tel" id="phone" name="phone" value="${esc(v.phone)}">
        </div>
        <div class="form-group">
          <label for="website">Website</label>
          <input type="url" id="website" name="website" value="${esc(v.website)}">
        </div>
      </div>

      <div class="form-group">
        <label for="hours">Opening Hours</label>
        <textarea id="hours" name="hours" style="min-height:60px">${esc(v.hours)}</textarea>
        <div class="hint">JSON or free text, e.g. {"mon":"09:00-22:00"}</div>
      </div>

      <div class="form-row" style="margin-bottom:.5rem">
        <div class="form-group">
          <label>Options</label>
          <div class="check-group">
            <input type="checkbox" id="halal_certified" name="halal_certified" value="1" ${checked(v.halal_certified)}>
            <label for="halal_certified" style="margin:0;font-weight:400">Halal certified</label>
          </div>
        </div>
        <div class="form-group">
          <label>&nbsp;</label>
          <div class="check-group">
            <input type="checkbox" id="published" name="published" value="1" ${checked(v.published)}>
            <label for="published" style="margin:0;font-weight:400">Published</label>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Create place'}</button>
        <a href="/admin/places" class="btn btn-secondary">Cancel</a>
      </div>
    </form>
    <script>
      (function() {
        var nameEl = document.getElementById('name');
        var slugEl = document.getElementById('slug');
        var edited = ${isEdit ? 'true' : 'false'};
        function slugify(str) {
          return str.toLowerCase().trim()
            .replace(/[^\\w\\s-]/g, '')
            .replace(/[\\s_-]+/g, '-')
            .replace(/^-+|-+$/, '');
        }
        slugEl.addEventListener('input', function() { edited = true; });
        nameEl.addEventListener('input', function() {
          if (!edited || slugEl.value === '') {
            slugEl.value = slugify(nameEl.value);
          }
        });
      })();
    </script>`;
}

// ---------------------------------------------------------------------------
// Photo gallery section for the edit page
// ---------------------------------------------------------------------------

function photoGalleryHtml(
  placeId: number,
  photos: PhotoRow[],
  cloudName: string,
  flash: string,
): string {
  const photoItems = photos
    .map(
      (ph, idx) => `
    <div style="display:flex;align-items:center;gap:.75rem;padding:.75rem 0;border-bottom:1px solid #f1f5f9">
      <img src="${cloudinaryThumb(cloudName, ph.cloudinary_public_id)}"
           alt="${esc(ph.caption ?? '')}" width="100" height="100"
           style="object-fit:cover;border-radius:4px;flex-shrink:0">
      <div style="flex:1;min-width:0">
        <div style="font-size:.75rem;color:#94a3b8;word-break:break-all;margin-bottom:.2rem">${esc(ph.cloudinary_public_id)}</div>
        ${ph.caption ? `<div style="font-size:.875rem">${esc(ph.caption)}</div>` : '<div style="font-size:.8rem;color:#cbd5e1">No caption</div>'}
      </div>
      <div style="display:flex;flex-direction:column;gap:.25rem;flex-shrink:0">
        ${idx > 0
          ? `<form method="POST" action="/admin/places/${placeId}/photos/${ph.id}/up">
               <button type="submit" class="btn btn-secondary btn-sm" title="Move up">↑</button>
             </form>`
          : `<button class="btn btn-secondary btn-sm" disabled style="opacity:.3">↑</button>`}
        ${idx < photos.length - 1
          ? `<form method="POST" action="/admin/places/${placeId}/photos/${ph.id}/down">
               <button type="submit" class="btn btn-secondary btn-sm" title="Move down">↓</button>
             </form>`
          : `<button class="btn btn-secondary btn-sm" disabled style="opacity:.3">↓</button>`}
      </div>
      <form method="POST" action="/admin/places/${placeId}/photos/${ph.id}/delete"
            onsubmit="return confirm('Delete this photo from Cloudinary?')" style="flex-shrink:0">
        <button type="submit" class="btn btn-danger btn-sm">Delete</button>
      </form>
    </div>`,
    )
    .join('');

  return `
    <div id="photos" style="margin-top:2rem">
      <h2 style="font-size:1.1rem;margin-bottom:1rem">Photos (${photos.length})</h2>
      ${flash}
      <div class="card">
        ${photos.length === 0
          ? `<p style="color:#94a3b8;text-align:center;padding:1.5rem 0;font-size:.875rem">No photos yet. Upload one below.</p>`
          : `<div>${photoItems}</div>`}
        <div style="border-top:2px dashed #e2e8f0;margin-top:1rem;padding-top:1rem">
          <h3 style="font-size:.9rem;font-weight:600;margin-bottom:.75rem;color:#374151">Upload new photo</h3>
          <form method="POST" action="/admin/places/${placeId}/photos/upload" enctype="multipart/form-data">
            <div class="form-row">
              <div class="form-group">
                <label for="photo">Image file *</label>
                <input type="file" id="photo" name="photo" accept="image/*" required
                       style="padding:.4rem;font-size:.875rem">
              </div>
              <div class="form-group">
                <label for="caption">Caption</label>
                <input type="text" id="caption" name="caption" placeholder="Optional description">
              </div>
            </div>
            <button type="submit" class="btn btn-primary">Upload photo</button>
          </form>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Route handlers — Places CRUD
// ---------------------------------------------------------------------------

/** GET /admin/places */
export async function handleAdminPlacesList(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const url = new URL((request as Request).url);
  const filterType = url.searchParams.get('type') ?? '';
  const filterPublished = url.searchParams.get('published') ?? '';
  const filterCity = url.searchParams.get('city') ?? '';
  const currentPage = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const offset = (currentPage - 1) * PLACES_PER_PAGE;

  // Build WHERE clause
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filterType) {
    conditions.push('p.place_type = ?');
    params.push(filterType);
  }
  if (filterPublished !== '') {
    conditions.push('p.published = ?');
    params.push(filterPublished === '1' ? 1 : 0);
  }
  if (filterCity) {
    conditions.push('p.city LIKE ?');
    params.push(`%${filterCity}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM places p ${where}`,
  )
    .bind(...params)
    .first<{ total: number }>();

  const total = countRow?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PLACES_PER_PAGE));

  const { results } = await env.DB.prepare(
    `SELECT p.id, p.name, p.slug, p.place_type, p.city, p.country, p.published,
            c.name AS category_name,
            (SELECT cloudinary_public_id FROM photos WHERE place_id = p.id ORDER BY sort_order LIMIT 1) AS first_photo
     FROM places p
     LEFT JOIN categories c ON p.category_id = c.id
     ${where}
     ORDER BY p.name
     LIMIT ? OFFSET ?`,
  )
    .bind(...params, PLACES_PER_PAGE, offset)
    .all<PlaceRow>();

  // Build filter query string for pagination links (preserve filters)
  const filterQs = new URLSearchParams();
  if (filterType) filterQs.set('type', filterType);
  if (filterPublished !== '') filterQs.set('published', filterPublished);
  if (filterCity) filterQs.set('city', filterCity);
  const filterStr = filterQs.toString();

  function pageLink(p: number): string {
    const qs = new URLSearchParams(filterQs);
    qs.set('page', String(p));
    return `/admin/places?${qs.toString()}`;
  }

  const cloudName = env.CLOUDINARY_CLOUD_NAME ?? '';

  const rows = results
    .map(
      (p) => `
    <tr>
      <td style="width:60px">
        ${p.first_photo && cloudName
          ? `<img src="${cloudinaryThumb(cloudName, p.first_photo)}" alt="" width="50" height="50" style="object-fit:cover;border-radius:3px;display:block">`
          : `<div style="width:50px;height:50px;background:#f1f5f9;border-radius:3px;display:flex;align-items:center;justify-content:center;color:#cbd5e1;font-size:.7rem">none</div>`}
      </td>
      <td>${esc(p.name)}<br><small style="color:#94a3b8">${esc(p.slug)}</small></td>
      <td><span class="badge ${p.place_type === 'prayer' ? 'badge-orange' : 'badge-blue'}">${esc(p.place_type)}</span></td>
      <td>${esc(p.city)}</td>
      <td>${esc(p.country)}</td>
      <td>${p.category_name ? esc(p.category_name) : '<span style="color:#94a3b8">—</span>'}</td>
      <td>
        <form method="POST" action="/admin/places/${p.id}/toggle-published" style="display:inline">
          <button type="submit" class="badge ${p.published ? 'badge-green' : 'badge-gray'}" style="cursor:pointer;border:none;padding:.25rem .5rem">
            ${p.published ? 'Yes' : 'No'}
          </button>
        </form>
      </td>
      <td>
        <div class="actions">
          <a href="/admin/places/${p.id}/edit" class="btn btn-secondary btn-sm">Edit</a>
          <a href="/admin/places/${p.id}/delete" class="btn btn-danger btn-sm">Delete</a>
        </div>
      </td>
    </tr>`,
    )
    .join('');

  const emptyRow =
    results.length === 0
      ? `<tr><td colspan="8" class="empty">No places found.</td></tr>`
      : '';

  // Pagination
  const paginationItems: string[] = [];
  if (currentPage > 1)
    paginationItems.push(`<a href="${pageLink(currentPage - 1)}">&larr; Prev</a>`);
  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= currentPage - 2 && i <= currentPage + 2)
    ) {
      paginationItems.push(
        i === currentPage
          ? `<span class="current">${i}</span>`
          : `<a href="${pageLink(i)}">${i}</a>`,
      );
    } else if (i === currentPage - 3 || i === currentPage + 3) {
      paginationItems.push(`<span>…</span>`);
    }
  }
  if (currentPage < totalPages)
    paginationItems.push(`<a href="${pageLink(currentPage + 1)}">Next &rarr;</a>`);

  const body = `
    <div class="table-header">
      <h1>Places <span style="font-weight:400;color:#94a3b8;font-size:1rem">(${total})</span></h1>
      <a href="/admin/places/new" class="btn btn-primary">+ New place</a>
    </div>
    ${flashHtml(url)}
    <div class="card" style="padding:1rem 1.5rem">
      <form method="GET" action="/admin/places">
        <div class="filters">
          <div class="form-group">
            <label>Type</label>
            <select name="type">
              <option value="" ${!filterType ? 'selected' : ''}>All types</option>
              <option value="restaurant" ${filterType === 'restaurant' ? 'selected' : ''}>Restaurant</option>
              <option value="prayer" ${filterType === 'prayer' ? 'selected' : ''}>Prayer place</option>
            </select>
          </div>
          <div class="form-group">
            <label>Published</label>
            <select name="published">
              <option value="" ${filterPublished === '' ? 'selected' : ''}>All</option>
              <option value="1" ${filterPublished === '1' ? 'selected' : ''}>Yes</option>
              <option value="0" ${filterPublished === '0' ? 'selected' : ''}>No</option>
            </select>
          </div>
          <div class="form-group">
            <label>City</label>
            <input type="text" name="city" value="${esc(filterCity)}" placeholder="Filter by city…">
          </div>
          <div class="form-group">
            <label>&nbsp;</label>
            <button type="submit" class="btn btn-secondary">Filter</button>
          </div>
          ${filterStr ? `<div class="form-group"><label>&nbsp;</label><a href="/admin/places" class="btn btn-secondary">Clear</a></div>` : ''}
        </div>
      </form>
    </div>
    <div class="card" style="padding:0 0 .5rem">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Photo</th>
              <th>Name / Slug</th>
              <th>Type</th>
              <th>City</th>
              <th>Country</th>
              <th>Category</th>
              <th>Published</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}${emptyRow}
          </tbody>
        </table>
      </div>
      ${paginationItems.length > 1 ? `<div class="pagination" style="padding:0 1rem 1rem">${paginationItems.join('')}</div>` : ''}
    </div>`;

  return html(page('Places', body, TABLE_STYLES + FORM_STYLES));
}

/** GET /admin/places/new */
export async function handleAdminPlaceNew(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const { results: categories } = await env.DB.prepare(
    `SELECT id, name, slug FROM categories ORDER BY name`,
  ).all<CategoryRow>();

  const body = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem">
      <a href="/admin/places" style="color:#64748b;font-size:.875rem">← Places</a>
    </div>
    <h1>New Place</h1>
    <div class="card">
      ${placeFormBody('/admin/places/new', {}, categories)}
    </div>`;

  return html(page('New Place', body, FORM_STYLES));
}

/** POST /admin/places/new */
export async function handleAdminPlaceCreate(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const req = request as Request;
  const text = await req.text();
  const p = new URLSearchParams(text);

  const name = p.get('name')?.trim() ?? '';
  const slug = p.get('slug')?.trim() ?? '';
  const description = p.get('description')?.trim() || null;
  const place_type = p.get('place_type') ?? 'restaurant';
  const category_id = p.get('category_id') ? Number(p.get('category_id')) : null;
  const address = p.get('address')?.trim() || null;
  const city = p.get('city')?.trim() ?? '';
  const country = p.get('country')?.trim() ?? '';
  const lat = p.get('lat') ? parseFloat(p.get('lat')!) : null;
  const lng = p.get('lng') ? parseFloat(p.get('lng')!) : null;
  const phone = p.get('phone')?.trim() || null;
  const website = p.get('website')?.trim() || null;
  const hours = p.get('hours')?.trim() || null;
  const halal_certified = p.get('halal_certified') === '1' ? 1 : 0;
  const published = p.get('published') === '1' ? 1 : 0;

  if (!name || !slug || !city || !country) {
    const { results: categories } = await env.DB.prepare(
      `SELECT id, name, slug FROM categories ORDER BY name`,
    ).all<CategoryRow>();

    const values: Partial<PlaceRow> = {
      name, slug, description, place_type, category_id: category_id ?? undefined,
      address, city, country, lat: lat ?? undefined, lng: lng ?? undefined,
      phone, website, hours, halal_certified, published,
    };

    const body = `
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem">
        <a href="/admin/places" style="color:#64748b;font-size:.875rem">← Places</a>
      </div>
      <h1>New Place</h1>
      <div class="card">
        ${placeFormBody('/admin/places/new', values, categories, 'Name, slug, city, and country are required.')}
      </div>`;

    return html(page('New Place', body, FORM_STYLES), 422);
  }

  // Check slug uniqueness
  const existing = await env.DB.prepare(
    `SELECT id FROM places WHERE slug = ?`,
  )
    .bind(slug)
    .first<{ id: number }>();

  if (existing) {
    const { results: categories } = await env.DB.prepare(
      `SELECT id, name, slug FROM categories ORDER BY name`,
    ).all<CategoryRow>();

    const values: Partial<PlaceRow> = {
      name, slug, description, place_type, category_id: category_id ?? undefined,
      address, city, country, lat: lat ?? undefined, lng: lng ?? undefined,
      phone, website, hours, halal_certified, published,
    };

    const body = `
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem">
        <a href="/admin/places" style="color:#64748b;font-size:.875rem">← Places</a>
      </div>
      <h1>New Place</h1>
      <div class="card">
        ${placeFormBody('/admin/places/new', values, categories, `Slug "${slug}" is already taken. Choose a different slug.`)}
      </div>`;

    return html(page('New Place', body, FORM_STYLES), 422);
  }

  await env.DB.prepare(
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

  return redirect(`/admin/places?ok=${encodeURIComponent(`Place "${name}" created.`)}`);
}

/** GET /admin/places/:id/edit */
export async function handleAdminPlaceEdit(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  if (!id) return redirect('/admin/places');

  const url = new URL((request as Request).url);

  const place = await env.DB.prepare(`SELECT * FROM places WHERE id = ?`)
    .bind(id)
    .first<PlaceRow>();

  if (!place) return redirect('/admin/places?err=Place+not+found');

  const [{ results: categories }, { results: photos }] = await Promise.all([
    env.DB.prepare(`SELECT id, name, slug FROM categories ORDER BY name`).all<CategoryRow>(),
    env.DB.prepare(`SELECT id, place_id, cloudinary_public_id, caption, sort_order FROM photos WHERE place_id = ? ORDER BY sort_order`).bind(id).all<PhotoRow>(),
  ]);

  const gallery = photoGalleryHtml(
    id,
    photos,
    env.CLOUDINARY_CLOUD_NAME ?? '',
    flashHtml(url),
  );

  const body = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem">
      <a href="/admin/places" style="color:#64748b;font-size:.875rem">← Places</a>
    </div>
    <h1>Edit: ${esc(place.name)}</h1>
    <div class="card">
      ${placeFormBody(`/admin/places/${id}/edit`, place, categories)}
    </div>
    ${gallery}`;

  return html(page(`Edit ${place.name}`, body, FORM_STYLES));
}

/** POST /admin/places/:id/edit */
export async function handleAdminPlaceUpdate(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  if (!id) return redirect('/admin/places');

  const existing = await env.DB.prepare(`SELECT id FROM places WHERE id = ?`)
    .bind(id)
    .first<{ id: number }>();
  if (!existing) return redirect('/admin/places?err=Place+not+found');

  const req = request as Request;
  const text = await req.text();
  const p = new URLSearchParams(text);

  const name = p.get('name')?.trim() ?? '';
  const slug = p.get('slug')?.trim() ?? '';
  const description = p.get('description')?.trim() || null;
  const place_type = p.get('place_type') ?? 'restaurant';
  const category_id = p.get('category_id') ? Number(p.get('category_id')) : null;
  const address = p.get('address')?.trim() || null;
  const city = p.get('city')?.trim() ?? '';
  const country = p.get('country')?.trim() ?? '';
  const lat = p.get('lat') ? parseFloat(p.get('lat')!) : null;
  const lng = p.get('lng') ? parseFloat(p.get('lng')!) : null;
  const phone = p.get('phone')?.trim() || null;
  const website = p.get('website')?.trim() || null;
  const hours = p.get('hours')?.trim() || null;
  const halal_certified = p.get('halal_certified') === '1' ? 1 : 0;
  const published = p.get('published') === '1' ? 1 : 0;

  if (!name || !slug || !city || !country) {
    const { results: categories } = await env.DB.prepare(
      `SELECT id, name, slug FROM categories ORDER BY name`,
    ).all<CategoryRow>();

    const values: Partial<PlaceRow> = {
      id, name, slug, description, place_type, category_id: category_id ?? undefined,
      address, city, country, lat: lat ?? undefined, lng: lng ?? undefined,
      phone, website, hours, halal_certified, published,
    };

    const body = `
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem">
        <a href="/admin/places" style="color:#64748b;font-size:.875rem">← Places</a>
      </div>
      <h1>Edit Place</h1>
      <div class="card">
        ${placeFormBody(`/admin/places/${id}/edit`, values, categories, 'Name, slug, city, and country are required.')}
      </div>`;

    return html(page('Edit Place', body, FORM_STYLES), 422);
  }

  // Check slug uniqueness (exclude current place)
  const slugConflict = await env.DB.prepare(
    `SELECT id FROM places WHERE slug = ? AND id != ?`,
  )
    .bind(slug, id)
    .first<{ id: number }>();

  if (slugConflict) {
    const { results: categories } = await env.DB.prepare(
      `SELECT id, name, slug FROM categories ORDER BY name`,
    ).all<CategoryRow>();

    const values: Partial<PlaceRow> = {
      id, name, slug, description, place_type, category_id: category_id ?? undefined,
      address, city, country, lat: lat ?? undefined, lng: lng ?? undefined,
      phone, website, hours, halal_certified, published,
    };

    const body = `
      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem">
        <a href="/admin/places" style="color:#64748b;font-size:.875rem">← Places</a>
      </div>
      <h1>Edit Place</h1>
      <div class="card">
        ${placeFormBody(`/admin/places/${id}/edit`, values, categories, `Slug "${slug}" is already taken by another place.`)}
      </div>`;

    return html(page('Edit Place', body, FORM_STYLES), 422);
  }

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

  return redirect(`/admin/places?ok=${encodeURIComponent(`Place "${name}" updated.`)}`);
}

/** GET /admin/places/:id/delete */
export async function handleAdminPlaceDeleteConfirm(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  if (!id) return redirect('/admin/places');

  const place = await env.DB.prepare(`SELECT id, name FROM places WHERE id = ?`)
    .bind(id)
    .first<{ id: number; name: string }>();

  if (!place) return redirect('/admin/places?err=Place+not+found');

  const body = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem">
      <a href="/admin/places" style="color:#64748b;font-size:.875rem">← Places</a>
    </div>
    <h1>Delete Place</h1>
    <div class="card" style="max-width:480px">
      <p style="margin-bottom:1rem">
        Are you sure you want to permanently delete
        <strong>${esc(place.name)}</strong>?
        This action cannot be undone.
      </p>
      <div class="form-actions">
        <form method="POST" action="/admin/places/${place.id}/delete">
          <button type="submit" class="btn btn-danger">Yes, delete</button>
        </form>
        <a href="/admin/places" class="btn btn-secondary">Cancel</a>
      </div>
    </div>`;

  return html(page('Delete Place', body, FORM_STYLES));
}

/** POST /admin/places/:id/delete */
export async function handleAdminPlaceDelete(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  if (!id) return redirect('/admin/places');

  const place = await env.DB.prepare(`SELECT id, name FROM places WHERE id = ?`)
    .bind(id)
    .first<{ id: number; name: string }>();

  if (!place) return redirect('/admin/places?err=Place+not+found');

  await env.DB.prepare(`DELETE FROM places WHERE id = ?`).bind(id).run();

  return redirect(`/admin/places?ok=${encodeURIComponent(`Place "${place.name}" deleted.`)}`);
}

/** POST /admin/places/:id/toggle-published */
export async function handleAdminPlaceTogglePublished(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  if (!id) return redirect('/admin/places');

  await env.DB.prepare(
    `UPDATE places SET published = CASE WHEN published = 1 THEN 0 ELSE 1 END WHERE id = ?`,
  )
    .bind(id)
    .run();

  // Redirect back to the referring page (or places list)
  const referer = (request as Request).headers.get('Referer') ?? '/admin/places';
  return redirect(referer);
}

// ---------------------------------------------------------------------------
// Route handlers — Users
// ---------------------------------------------------------------------------

/** GET /admin/users */
export async function handleAdminUsers(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const url = new URL((request as Request).url);
  const currentUserId = (request as AdminRequest).adminUser?.id;

  const { results: users } = await env.DB.prepare(
    `SELECT id, username, created_at, last_login FROM admin_users ORDER BY username`,
  ).all<AdminUserRow>();

  const rows = users
    .map(
      (u) => `
    <tr>
      <td>
        ${esc(u.username)}
        ${u.id === currentUserId ? ' <span class="badge badge-blue">you</span>' : ''}
      </td>
      <td style="color:#64748b;font-size:.8rem">${u.last_login ? esc(u.last_login.replace('T', ' ').slice(0, 16)) : '—'}</td>
      <td style="color:#64748b;font-size:.8rem">${esc(u.created_at.replace('T', ' ').slice(0, 16))}</td>
      <td>
        ${
          u.id === currentUserId
            ? '<span style="color:#94a3b8;font-size:.8rem">Cannot delete yourself</span>'
            : `<form method="POST" action="/admin/users/${u.id}/delete" onsubmit="return confirm('Delete user ${esc(u.username)}? This cannot be undone.')">
                 <button type="submit" class="btn btn-danger btn-sm">Delete</button>
               </form>`
        }
      </td>
    </tr>`,
    )
    .join('');

  const body = `
    <div class="table-header">
      <h1>Admin Users</h1>
      <a href="/admin/users/new" class="btn btn-primary">+ New user</a>
    </div>
    ${flashHtml(url)}
    <div class="card" style="padding:0 0 .5rem">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Last Login</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;

  return html(page('Users', body, TABLE_STYLES));
}

/** GET /admin/users/new */
export function handleAdminUserNew(request: IRequest): Response {
  const url = new URL((request as Request).url);
  const err = url.searchParams.get('err') ?? '';

  const body = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem">
      <a href="/admin/users" style="color:#64748b;font-size:.875rem">← Users</a>
    </div>
    <h1>New Admin User</h1>
    <div class="card" style="max-width:480px">
      ${err ? `<div class="flash-error">${esc(err)}</div>` : ''}
      <form method="POST" action="/admin/users/new">
        <div class="form-group">
          <label for="username">Username *</label>
          <input type="text" id="username" name="username" required autocomplete="off">
        </div>
        <div class="form-group">
          <label for="password">Password *</label>
          <input type="password" id="password" name="password" required autocomplete="new-password" minlength="8">
          <div class="hint">Minimum 8 characters.</div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Create user</button>
          <a href="/admin/users" class="btn btn-secondary">Cancel</a>
        </div>
      </form>
    </div>`;

  return html(page('New User', body, FORM_STYLES));
}

/** POST /admin/users/new */
export async function handleAdminUserCreate(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const req = request as Request;
  const text = await req.text();
  const p = new URLSearchParams(text);

  const username = p.get('username')?.trim() ?? '';
  const password = p.get('password') ?? '';

  if (!username || !password) {
    return redirect(`/admin/users/new?err=${encodeURIComponent('Username and password are required.')}`);
  }

  if (password.length < 8) {
    return redirect(`/admin/users/new?err=${encodeURIComponent('Password must be at least 8 characters.')}`);
  }

  // Check username uniqueness
  const existing = await env.DB.prepare(
    `SELECT id FROM admin_users WHERE username = ?`,
  )
    .bind(username)
    .first<{ id: number }>();

  if (existing) {
    return redirect(`/admin/users/new?err=${encodeURIComponent(`Username "${username}" is already taken.`)}`);
  }

  const passwordHash = await hashPassword(password);

  await env.DB.prepare(
    `INSERT INTO admin_users (username, password_hash) VALUES (?, ?)`,
  )
    .bind(username, passwordHash)
    .run();

  return redirect(`/admin/users?ok=${encodeURIComponent(`User "${username}" created.`)}`);
}

/** POST /admin/users/:id/delete */
export async function handleAdminUserDelete(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  if (!id) return redirect('/admin/users');

  const currentUserId = (request as AdminRequest).adminUser?.id;
  if (id === currentUserId) {
    return redirect(`/admin/users?err=${encodeURIComponent('You cannot delete your own account.')}`);
  }

  const user = await env.DB.prepare(
    `SELECT id, username FROM admin_users WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: number; username: string }>();

  if (!user) return redirect('/admin/users?err=User+not+found');

  await env.DB.prepare(`DELETE FROM admin_users WHERE id = ?`).bind(id).run();

  return redirect(`/admin/users?ok=${encodeURIComponent(`User "${user.username}" deleted.`)}`);
}

// ---------------------------------------------------------------------------
// Route handlers — Photo management
// ---------------------------------------------------------------------------

/** POST /admin/places/:id/photos/upload */
export async function handleAdminPhotoUpload(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  if (!id) return redirect('/admin/places');

  const place = await env.DB.prepare(`SELECT id FROM places WHERE id = ?`)
    .bind(id)
    .first<{ id: number }>();
  if (!place) return redirect('/admin/places?err=Place+not+found');

  let formData: FormData;
  try {
    formData = await (request as Request).formData();
  } catch {
    return redirect(
      `/admin/places/${id}/edit?err=${encodeURIComponent('Could not parse form data.')}#photos`,
    );
  }

  const file = formData.get('photo');
  if (!file || typeof file === 'string' || (file as Blob).size === 0) {
    return redirect(
      `/admin/places/${id}/edit?err=${encodeURIComponent('No image file selected.')}#photos`,
    );
  }

  // Build signed Cloudinary upload request
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await cloudinarySign({ timestamp }, env.CLOUDINARY_API_SECRET);

  const cloudForm = new FormData();
  cloudForm.append('file', file);
  cloudForm.append('api_key', env.CLOUDINARY_API_KEY);
  cloudForm.append('timestamp', timestamp);
  cloudForm.append('signature', signature);

  let publicId: string;
  try {
    const cloudRes = await fetch(
      `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
      { method: 'POST', body: cloudForm },
    );
    if (!cloudRes.ok) {
      const errBody = await cloudRes.text().catch(() => '');
      console.error('Cloudinary upload error', cloudRes.status, errBody);
      return redirect(
        `/admin/places/${id}/edit?err=${encodeURIComponent('Cloudinary upload failed. Check Worker logs.')}#photos`,
      );
    }
    const cloudData = (await cloudRes.json()) as { public_id: string };
    publicId = cloudData.public_id;
  } catch (e) {
    console.error('Cloudinary fetch error', e);
    return redirect(
      `/admin/places/${id}/edit?err=${encodeURIComponent('Network error contacting Cloudinary.')}#photos`,
    );
  }

  const caption = (formData.get('caption') as string | null)?.trim() || null;

  // Determine next sort_order
  const maxRow = await env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM photos WHERE place_id = ?`,
  )
    .bind(id)
    .first<{ m: number }>();
  const sortOrder = (maxRow?.m ?? -1) + 1;

  await env.DB.prepare(
    `INSERT INTO photos (place_id, cloudinary_public_id, caption, sort_order) VALUES (?, ?, ?, ?)`,
  )
    .bind(id, publicId, caption, sortOrder)
    .run();

  return redirect(
    `/admin/places/${id}/edit?ok=${encodeURIComponent('Photo uploaded successfully.')}#photos`,
  );
}

/** POST /admin/places/:id/photos/:photoId/delete */
export async function handleAdminPhotoDelete(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  const photoId = Number((request as any).params?.photoId);
  if (!id || !photoId) return redirect('/admin/places');

  const photo = await env.DB.prepare(
    `SELECT id, cloudinary_public_id FROM photos WHERE id = ? AND place_id = ?`,
  )
    .bind(photoId, id)
    .first<{ id: number; cloudinary_public_id: string }>();

  if (!photo) {
    return redirect(
      `/admin/places/${id}/edit?err=${encodeURIComponent('Photo not found.')}#photos`,
    );
  }

  // Best-effort delete from Cloudinary
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await cloudinarySign(
      { public_id: photo.cloudinary_public_id, timestamp },
      env.CLOUDINARY_API_SECRET,
    );
    const cloudForm = new FormData();
    cloudForm.append('public_id', photo.cloudinary_public_id);
    cloudForm.append('api_key', env.CLOUDINARY_API_KEY);
    cloudForm.append('timestamp', timestamp);
    cloudForm.append('signature', signature);
    await fetch(
      `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/destroy`,
      { method: 'POST', body: cloudForm },
    );
  } catch (e) {
    console.error('Cloudinary destroy error', e);
  }

  await env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(photoId).run();

  return redirect(
    `/admin/places/${id}/edit?ok=${encodeURIComponent('Photo deleted.')}#photos`,
  );
}

/** POST /admin/places/:id/photos/:photoId/up — swap with the previous photo */
export async function handleAdminPhotoMoveUp(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  const photoId = Number((request as any).params?.photoId);
  if (!id || !photoId) return redirect('/admin/places');

  const photo = await env.DB.prepare(
    `SELECT id, sort_order FROM photos WHERE id = ? AND place_id = ?`,
  )
    .bind(photoId, id)
    .first<{ id: number; sort_order: number }>();
  if (!photo) return redirect(`/admin/places/${id}/edit#photos`);

  const prev = await env.DB.prepare(
    `SELECT id, sort_order FROM photos WHERE place_id = ? AND sort_order < ? ORDER BY sort_order DESC LIMIT 1`,
  )
    .bind(id, photo.sort_order)
    .first<{ id: number; sort_order: number }>();

  if (prev) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE photos SET sort_order = ? WHERE id = ?`).bind(prev.sort_order, photo.id),
      env.DB.prepare(`UPDATE photos SET sort_order = ? WHERE id = ?`).bind(photo.sort_order, prev.id),
    ]);
  }

  return redirect(`/admin/places/${id}/edit#photos`);
}

/** POST /admin/places/:id/photos/:photoId/down — swap with the next photo */
export async function handleAdminPhotoMoveDown(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  const photoId = Number((request as any).params?.photoId);
  if (!id || !photoId) return redirect('/admin/places');

  const photo = await env.DB.prepare(
    `SELECT id, sort_order FROM photos WHERE id = ? AND place_id = ?`,
  )
    .bind(photoId, id)
    .first<{ id: number; sort_order: number }>();
  if (!photo) return redirect(`/admin/places/${id}/edit#photos`);

  const next = await env.DB.prepare(
    `SELECT id, sort_order FROM photos WHERE place_id = ? AND sort_order > ? ORDER BY sort_order ASC LIMIT 1`,
  )
    .bind(id, photo.sort_order)
    .first<{ id: number; sort_order: number }>();

  if (next) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE photos SET sort_order = ? WHERE id = ?`).bind(next.sort_order, photo.id),
      env.DB.prepare(`UPDATE photos SET sort_order = ? WHERE id = ?`).bind(photo.sort_order, next.id),
    ]);
  }

  return redirect(`/admin/places/${id}/edit#photos`);
}

// ---------------------------------------------------------------------------
// Route handlers — Submissions review queue
// ---------------------------------------------------------------------------

interface SubmissionRow {
  id: number;
  name: string;
  description: string | null;
  address: string | null;
  city: string;
  country: string;
  phone: string | null;
  website: string | null;
  place_type: string;
  category_id: number | null;
  submitter_email: string | null;
  status: string;
  rejection_note: string | null;
  created_at: string;
  category_name?: string | null;
}

const SUBMISSIONS_PER_PAGE = 30;

/** GET /admin/submissions */
export async function handleAdminSubmissionsList(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const url = new URL((request as Request).url);
  const status = url.searchParams.get('status') ?? 'pending';
  const currentPage = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const offset = (currentPage - 1) * SUBMISSIONS_PER_PAGE;
  const flash = flashHtml(url);

  const validStatuses = ['pending', 'approved', 'rejected'];
  const safeStatus = validStatuses.includes(status) ? status : 'pending';

  const [rowsResult, countResult] = await Promise.all([
    env.DB.prepare(
      `SELECT s.*, c.name AS category_name
       FROM submissions s
       LEFT JOIN categories c ON c.id = s.category_id
       WHERE s.status = ?
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(safeStatus, SUBMISSIONS_PER_PAGE, offset)
      .all<SubmissionRow>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM submissions WHERE status = ?`,
    )
      .bind(safeStatus)
      .first<{ total: number }>(),
  ]);

  const rows = rowsResult.results;
  const total = countResult?.total ?? 0;
  const totalPages = Math.ceil(total / SUBMISSIONS_PER_PAGE);

  const statusTabs = ['pending', 'approved', 'rejected']
    .map(
      (s) =>
        `<a href="/admin/submissions?status=${s}" class="btn btn-sm ${s === safeStatus ? 'btn-primary' : 'btn-secondary'}">${s.charAt(0).toUpperCase() + s.slice(1)}</a>`,
    )
    .join('');

  const tableRows = rows.length === 0
    ? `<tr><td colspan="8" class="empty">No ${safeStatus} submissions.</td></tr>`
    : rows.map((s) => `
      <tr>
        <td>#${s.id}</td>
        <td><strong>${esc(s.name)}</strong><br><span style="color:#666;font-size:.8rem">${esc(s.city)}, ${esc(s.country)}</span></td>
        <td>${esc(s.place_type)}</td>
        <td>${s.category_name ? esc(s.category_name) : '<span style="color:#aaa">—</span>'}</td>
        <td>${s.submitter_email ? esc(s.submitter_email) : '<span style="color:#aaa">—</span>'}</td>
        <td>${new Date(s.created_at).toLocaleDateString()}</td>
        <td>
          <span class="badge ${s.status === 'pending' ? 'badge-orange' : s.status === 'approved' ? 'badge-green' : 'badge-gray'}">${esc(s.status)}</span>
          ${s.rejection_note ? `<br><span style="font-size:.75rem;color:#666">${esc(s.rejection_note)}</span>` : ''}
        </td>
        <td class="actions">
          <a href="/admin/submissions/${s.id}" class="btn btn-sm btn-secondary">View</a>
          ${s.status === 'pending' ? `
            <form method="POST" action="/admin/submissions/${s.id}/approve" style="display:inline">
              <button class="btn btn-sm btn-primary" onclick="return confirm('Approve this submission?')">Approve</button>
            </form>
            <form method="POST" action="/admin/submissions/${s.id}/reject" style="display:inline">
              <input type="hidden" name="note" value="">
              <button class="btn btn-sm btn-danger" onclick="return confirm('Reject this submission?')">Reject</button>
            </form>
          ` : ''}
        </td>
      </tr>
    `).join('');

  let paginationHtml = '';
  if (totalPages > 1) {
    const pages = [];
    for (let i = 1; i <= totalPages; i++) {
      pages.push(
        i === currentPage
          ? `<span class="current">${i}</span>`
          : `<a href="/admin/submissions?status=${safeStatus}&page=${i}">${i}</a>`,
      );
    }
    paginationHtml = `<div class="pagination">${pages.join('')}</div>`;
  }

  const body = `
    <div class="table-header">
      <h1>Submissions</h1>
    </div>
    ${flash}
    <div class="filters" style="margin-bottom:1rem">
      ${statusTabs}
      <span style="color:#64748b;font-size:.85rem;margin-left:.5rem">${total} total</span>
    </div>
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name / Location</th>
              <th>Type</th>
              <th>Category</th>
              <th>Email</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>
    </div>
    ${paginationHtml}
  `;

  return html(page('Submissions', body, TABLE_STYLES + FORM_STYLES));
}

/** GET /admin/submissions/:id */
export async function handleAdminSubmissionView(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  if (!id) return redirect('/admin/submissions');

  const sub = await env.DB.prepare(
    `SELECT s.*, c.name AS category_name
     FROM submissions s
     LEFT JOIN categories c ON c.id = s.category_id
     WHERE s.id = ?`,
  )
    .bind(id)
    .first<SubmissionRow>();

  if (!sub) return redirect('/admin/submissions?err=Submission+not+found');

  const url = new URL((request as Request).url);
  const flash = flashHtml(url);

  const field = (label: string, value: string | null | undefined) =>
    value ? `<div class="form-group"><label>${esc(label)}</label><div style="padding:.4rem 0;color:#111">${esc(value)}</div></div>` : '';

  const approveRejectButtons = sub.status === 'pending' ? `
    <div style="display:flex;gap:.75rem;margin-top:1.5rem">
      <form method="POST" action="/admin/submissions/${sub.id}/approve">
        <button class="btn btn-primary" onclick="return confirm('Approve and create place?')">Approve — Create Place</button>
      </form>
      <form method="POST" action="/admin/submissions/${sub.id}/reject">
        <div style="display:flex;gap:.5rem;align-items:center">
          <input type="text" name="note" placeholder="Rejection note (optional)" style="width:260px">
          <button class="btn btn-danger" onclick="return confirm('Reject this submission?')">Reject</button>
        </div>
      </form>
    </div>
  ` : `<div style="margin-top:1.5rem"><span class="badge ${sub.status === 'approved' ? 'badge-green' : 'badge-gray'}" style="font-size:.9rem;padding:.35rem .75rem">${esc(sub.status)}</span>${sub.rejection_note ? `<span style="margin-left:.75rem;color:#666;font-size:.85rem">${esc(sub.rejection_note)}</span>` : ''}</div>`;

  const body = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.25rem">
      <a href="/admin/submissions?status=${sub.status}" class="btn btn-secondary btn-sm">← Back</a>
      <h1 style="margin:0">Submission #${sub.id}</h1>
    </div>
    ${flash}
    <div class="card">
      <div class="form-row">
        ${field('Name', sub.name)}
        ${field('Place Type', sub.place_type)}
      </div>
      <div class="form-group">
        <label>Description</label>
        <div style="padding:.4rem 0;color:#111;white-space:pre-wrap">${sub.description ? esc(sub.description) : '<span style="color:#aaa">—</span>'}</div>
      </div>
      <div class="form-row">
        ${field('Address', sub.address)}
        ${field('City', sub.city)}
      </div>
      <div class="form-row">
        ${field('Country', sub.country)}
        ${field('Category', sub.category_name ?? null)}
      </div>
      <div class="form-row">
        ${field('Phone', sub.phone)}
        ${field('Website', sub.website)}
      </div>
      ${field('Submitter Email', sub.submitter_email)}
      <div class="form-group">
        <label>Submitted</label>
        <div style="padding:.4rem 0;color:#111">${new Date(sub.created_at).toLocaleString()}</div>
      </div>
      ${approveRejectButtons}
    </div>
  `;

  return html(page(`Submission #${sub.id}`, body, FORM_STYLES));
}

/** POST /admin/submissions/:id/approve */
export async function handleAdminSubmissionApprove(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  if (!id) return redirect('/admin/submissions');

  const sub = await env.DB.prepare(
    `SELECT * FROM submissions WHERE id = ? AND status = 'pending'`,
  )
    .bind(id)
    .first<SubmissionRow>();

  if (!sub) {
    return redirect(
      `/admin/submissions?err=${encodeURIComponent('Submission not found or already processed.')}`,
    );
  }

  // Generate a unique slug from the name
  const baseSlug = sub.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  let slug = baseSlug;
  let suffix = 1;
  while (true) {
    const existing = await env.DB.prepare(`SELECT id FROM places WHERE slug = ?`)
      .bind(slug)
      .first<{ id: number }>();
    if (!existing) break;
    slug = `${baseSlug}-${suffix++}`;
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO places
         (slug, name, description, place_type, category_id, address, city, country,
          phone, website, halal_certified, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    ).bind(
      slug,
      sub.name,
      sub.description ?? null,
      sub.place_type ?? 'restaurant',
      sub.category_id ?? null,
      sub.address ?? null,
      sub.city,
      sub.country,
      sub.phone ?? null,
      sub.website ?? null,
    ),
    env.DB.prepare(
      `UPDATE submissions SET status = 'approved' WHERE id = ?`,
    ).bind(id),
  ]);

  return redirect(
    `/admin/submissions?status=pending&ok=${encodeURIComponent(`Submission approved. Place "${sub.name}" created (unpublished).`)}`,
  );
}

/** POST /admin/submissions/:id/reject */
export async function handleAdminSubmissionReject(
  request: IRequest,
  env: Env,
): Promise<Response> {
  const id = Number((request as any).params?.id);
  if (!id) return redirect('/admin/submissions');

  const sub = await env.DB.prepare(
    `SELECT id, name FROM submissions WHERE id = ? AND status = 'pending'`,
  )
    .bind(id)
    .first<{ id: number; name: string }>();

  if (!sub) {
    return redirect(
      `/admin/submissions?err=${encodeURIComponent('Submission not found or already processed.')}`,
    );
  }

  let note: string | null = null;
  try {
    const text = await (request as Request).text();
    const params = new URLSearchParams(text);
    note = params.get('note')?.trim() || null;
  } catch {
    // ignore parse errors
  }

  await env.DB.prepare(
    `UPDATE submissions SET status = 'rejected', rejection_note = ? WHERE id = ?`,
  )
    .bind(note, id)
    .run();

  return redirect(
    `/admin/submissions?status=pending&ok=${encodeURIComponent(`Submission "${sub.name}" rejected.`)}`,
  );
}
