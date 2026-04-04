# Halal Directory

A Cloudflare-powered directory of halal restaurants and businesses.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Astro (static site, `site/`) |
| API & Admin | Cloudflare Worker + itty-router (`workers/`) |
| Database | Cloudflare D1 (SQLite) |
| Images | Cloudinary |

---

## Development

### Prerequisites

- Node.js 20+
- `npm install` in the repo root **and** inside `workers/`

### Run the Worker locally

```bash
cd workers
npx wrangler dev
```

The API is served at `http://localhost:8787`.

### Run the Astro site locally

```bash
cd site
npm run dev
```

The site is served at `http://localhost:4321`.

---

## Database migrations

Apply all migrations to the local D1 database:

```bash
cd workers
npx wrangler d1 migrations apply halal-directory --local
```

This will create the schema and seed the default admin user (see below).

---

## Admin panel

The admin panel is served directly by the Worker at `/admin/*` — it is
**not** part of the Astro build.

| URL | Description |
|-----|-------------|
| `/admin/login` | Login form |
| `/admin` | Dashboard |
| `/admin/places` | Manage listings (placeholder) |
| `/admin/users` | Manage admin users (placeholder) |

### Seed credentials

Migration `0003_seed_admin_user.sql` inserts a default admin user:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin123` |

**Change the password after first login in any deployed or staging environment.**

---

## Cloudinary image management

Photos for listings are stored in [Cloudinary](https://cloudinary.com). The
Worker uploads images server-side using a signed API call — no browser-to-CDN
upload, no public upload preset required.

### Required Worker secrets

Set these once per environment with `wrangler secret put`:

| Secret | Description |
|--------|-------------|
| `CLOUDINARY_CLOUD_NAME` | Your Cloudinary cloud name (e.g. `my-cloud`) |
| `CLOUDINARY_API_KEY` | API key from the Cloudinary dashboard |
| `CLOUDINARY_API_SECRET` | API secret from the Cloudinary dashboard |
| `ADMIN_SESSION_SECRET` | Random secret for admin session signing |

```bash
cd workers
wrangler secret put CLOUDINARY_CLOUD_NAME
wrangler secret put CLOUDINARY_API_KEY
wrangler secret put CLOUDINARY_API_SECRET
wrangler secret put ADMIN_SESSION_SECRET
```

### Photo management (admin panel)

On each place's edit page (`/admin/places/:id/edit`) there is a **Photos**
section below the main form:

- **Upload** — multipart form → Worker signs and proxies the upload to
  Cloudinary's `/image/upload` endpoint; `cloudinary_public_id` is saved to
  the `photos` table.
- **Delete** — calls Cloudinary `/image/destroy` (best-effort) then removes the
  row from `photos`.
- **Reorder** — ↑ / ↓ arrows swap `sort_order` values between adjacent rows.

The places list (`/admin/places`) shows a 100×100 thumbnail of the first photo
for each listing.

---

## Authentication

The Worker supports two auth methods:

- **Admin session** — cookie-based (`HttpOnly`, `SameSite=Strict`, 7-day expiry). Set by `POST /admin/login` or `POST /api/auth/login`.
- **API key** — `Authorization: Bearer <key>` header. Keys are stored hashed in the `api_keys` table with comma-separated scopes (`read`, `write`).

Password hashing uses PBKDF2-SHA256 (100 000 iterations, 32-byte key) via the Web Crypto API.

---

## Project structure

```
halal-directory/
├── site/                   # Astro frontend
│   └── src/
│       ├── pages/          # Route pages
│       └── layouts/        # Shared layouts
└── workers/                # Cloudflare Worker
    ├── migrations/         # D1 SQL migrations
    └── src/
        ├── index.ts        # Router + API routes
        ├── auth.ts         # PBKDF2, session helpers, auth middleware
        └── admin.ts        # Admin HTML routes (server-rendered)
```
