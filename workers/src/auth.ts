/**
 * Auth helpers for Halal Directory Worker
 *
 * - PBKDF2 password hashing via Web Crypto (no npm deps)
 * - Session token generation (32-byte random hex) + SHA-256 hash for DB storage
 * - Auth middleware: Bearer API key OR session cookie
 */

import type { IRequest } from 'itty-router';
import type { Env } from './index';

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

const enc = (s: string) => new TextEncoder().encode(s);

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** SHA-256 hex of a token string */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc(token));
  return toHex(digest);
}

/** Generate a cryptographically random 32-byte hex token */
export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

/**
 * Hash a password with PBKDF2.
 * Returns "<salt>:<hash>" where both parts are hex strings.
 */
export async function hashPassword(password: string): Promise<string> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const salt = toHex(saltBytes.buffer);

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc(salt), iterations: 100_000 },
    keyMaterial,
    256,
  );

  return `${salt}:${toHex(derived)}`;
}

/** Verify a password against a stored "<salt>:<hash>" string */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc(salt), iterations: 100_000 },
    keyMaterial,
    256,
  );

  return toHex(derived) === expected;
}

// ---------------------------------------------------------------------------
// Auth context — stored on the request via a plain property bag
// ---------------------------------------------------------------------------

export type AuthScope = 'read' | 'write' | 'admin';

export interface AuthContext {
  type: 'session' | 'api_key';
  userId?: number;
  scopes: AuthScope[];
}

/** IRequest extended with the auth context attached by authMiddleware */
export type AuthedRequest = IRequest & { auth?: AuthContext };

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

function getSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k?.trim() === 'session') return v?.trim() ?? null;
  }
  return null;
}

/**
 * Auth middleware — attaches `auth` to the request if a valid credential is
 * found.  Does NOT reject; route handlers call requireAuth() themselves.
 */
export async function authMiddleware(
  request: IRequest,
  env: Env,
): Promise<void> {
  const req = request as AuthedRequest;
  const authHeader = (request as Request).headers.get('Authorization');

  // 1. Bearer API key
  if (authHeader?.startsWith('Bearer ')) {
    const rawKey = authHeader.slice(7).trim();
    const keyHash = await hashToken(rawKey);
    const row = await env.DB.prepare(
      `SELECT id, scopes FROM api_keys WHERE key_hash = ?`,
    )
      .bind(keyHash)
      .first<{ id: number; scopes: string }>();

    if (row) {
      req.auth = {
        type: 'api_key',
        scopes: row.scopes.split(',').map((s) => s.trim()) as AuthScope[],
      };
      return;
    }
  }

  // 2. Session cookie
  const cookieHeader = (request as Request).headers.get('Cookie');
  const sessionToken = getSessionCookie(cookieHeader);
  if (sessionToken) {
    const tokenHash = await hashToken(sessionToken);
    const row = await env.DB.prepare(
      `SELECT s.user_id FROM sessions s
       WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    )
      .bind(tokenHash)
      .first<{ user_id: number }>();

    if (row) {
      req.auth = {
        type: 'session',
        userId: row.user_id,
        scopes: ['read', 'write', 'admin'],
      };
    }
  }
}

/**
 * Returns an error Response if the request lacks valid auth, otherwise
 * returns undefined (pass-through).
 *
 * @param allowApiKey  Allow Bearer API-key auth in addition to session auth.
 *                     When false, only admin session is accepted.
 */
export function requireAuth(
  allowApiKey: boolean,
): (request: AuthedRequest) => Response | undefined {
  return (request: AuthedRequest) => {
    const auth = request.auth;
    if (!auth) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (auth.type === 'api_key') {
      if (!allowApiKey) {
        return Response.json(
          { error: 'Forbidden: admin session required' },
          { status: 403 },
        );
      }
      if (!auth.scopes.includes('write')) {
        return Response.json(
          { error: 'Forbidden: write scope required' },
          { status: 403 },
        );
      }
    }
    return undefined;
  };
}
