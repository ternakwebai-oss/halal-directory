/**
 * Admin panel — server-rendered HTML routes
 *
 * All responses are plain HTML produced by the Worker.
 * No Astro, no frontend framework.
 *
 * Routes wired in index.ts:
 *   GET  /admin/login   → login form
 *   POST /admin/login   → process credentials → set cookie → redirect /admin
 *   GET  /admin/logout  → clear cookie → redirect /admin/login
 *   GET  /admin         → dashboard (protected)
 *   GET  /admin/places  → places placeholder (protected)
 *   GET  /admin/users   → users placeholder (protected)
 *
 * Auth middleware (adminAuthMiddleware) must run before all /admin/* routes
 * except /admin/login.
 */

import type { IRequest } from 'itty-router';
import type { Env } from './index';
import { generateToken, hashToken, verifyPassword } from './auth';

const SESSION_DURATION_DAYS = 7;

// ---------------------------------------------------------------------------
// Tiny HTML escape helper
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Shared layout helpers
// ---------------------------------------------------------------------------

function navBar(): string {
  return `
  <nav>
    <span class="brand">Halal Directory</span>
    <a href="/admin">Dashboard</a>
    <a href="/admin/places">Places</a>
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
  }
  nav a { color: #cbd5e1; text-decoration: none; font-size: .875rem; }
  nav a:hover { color: #fff; }
  nav .brand { font-weight: 600; color: #fff; margin-right: auto; }
  main { max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.5rem; margin-bottom: 1rem; }
`;

// ---------------------------------------------------------------------------
// HTML page builders
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

function dashboardPage(username: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard — Halal Directory Admin</title>
  <style>
    ${BASE_STYLES}
    .welcome { color: #555; margin-bottom: 1.5rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }
    .tile {
      background: #fff; border-radius: 8px; padding: 1.25rem 1.5rem;
      box-shadow: 0 1px 4px rgba(0,0,0,.08); text-decoration: none; color: #111;
      display: block;
    }
    .tile:hover { box-shadow: 0 2px 8px rgba(0,0,0,.15); }
    .tile h2 { font-size: 1rem; margin-bottom: .25rem; }
    .tile p { font-size: .8rem; color: #666; }
  </style>
</head>
<body>
  ${navBar()}
  <main>
    <h1>Admin Dashboard</h1>
    <p class="welcome">Welcome, ${esc(username)}.</p>
    <div class="grid">
      <a class="tile" href="/admin/places">
        <h2>Places</h2>
        <p>Manage listings</p>
      </a>
      <a class="tile" href="/admin/users">
        <h2>Users</h2>
        <p>Manage admin users</p>
      </a>
    </div>
  </main>
</body>
</html>`;
}

function placeholderPage(title: string, username: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} — Halal Directory Admin</title>
  <style>
    ${BASE_STYLES}
    p { color: #555; margin-bottom: 1rem; }
    a.back { color: #2563eb; text-decoration: none; font-size: .875rem; }
    a.back:hover { text-decoration: underline; }
  </style>
</head>
<body>
  ${navBar()}
  <main>
    <h1>${esc(title)}</h1>
    <p>Coming soon — placeholder page.</p>
    <a class="back" href="/admin">← Back to Dashboard</a>
  </main>
</body>
</html>`;
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
// Route handlers
// ---------------------------------------------------------------------------

/** GET /admin/login */
export function handleAdminLoginPage(_request: IRequest): Response {
  return new Response(loginPage(), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
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
    return new Response(loginPage('Username and password are required'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const user = await env.DB.prepare(
    `SELECT id, password_hash FROM admin_users WHERE username = ?`,
  )
    .bind(username)
    .first<{ id: number; password_hash: string }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return new Response(loginPage('Invalid username or password'), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
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
  return new Response(dashboardPage(username), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** GET /admin/places */
export function handleAdminPlaces(request: IRequest): Response {
  const username = (request as AdminRequest).adminUser?.username ?? 'Admin';
  return new Response(placeholderPage('Places', username), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** GET /admin/users */
export function handleAdminUsers(request: IRequest): Response {
  const username = (request as AdminRequest).adminUser?.username ?? 'Admin';
  return new Response(placeholderPage('Users', username), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
