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
