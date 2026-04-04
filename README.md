# Halal Directory

A fully serverless directory of halal restaurants and businesses, built on Cloudflare's edge stack.

## Architecture

```
Browser / Search Engine
       │
       ├─── Static assets + SSR pages ──▶  Cloudflare Pages
       │                                        │
       │                                   Astro (site/)
       │                                   @astrojs/cloudflare
       │
       └─── API + Admin ──▶  Cloudflare Worker (workers/)
                                   │
                          ┌────────┴────────┐
                          │                 │
                     D1 (SQLite)       Cloudinary
                   (places, users,    (listing photos,
                    api_keys, etc.)    server-side upload)
```

| Layer | Technology |
|-------|-----------|
| Frontend | Astro (SSR, `site/`) |
| API & Admin | Cloudflare Worker + itty-router (`workers/`) |
| Database | Cloudflare D1 (SQLite) |
| Images | Cloudinary (signed server-side upload) |
| Bot protection | Cloudflare Turnstile |
| Search | SQLite FTS5 full-text search |

---

## Project structure

```
halal-directory/
├── site/                         # Astro frontend (Cloudflare Pages)
│   ├── astro.config.mjs
│   ├── public/
│   │   ├── robots.txt
│   │   ├── ads.txt
│   │   └── favicon.*
│   └── src/
│       ├── layouts/
│       │   └── Base.astro        # Shared HTML shell, SEO tags, AdSense loader
│       ├── pages/
│       │   ├── index.astro       # Homepage — recent listings, featured cities
│       │   ├── search.astro      # Full-text search results
│       │   ├── map.astro         # Leaflet map of all published places
│       │   ├── submit.astro      # Public submission form + Turnstile
│       │   ├── 404.astro         # Custom 404 page
│       │   ├── categories/       # Category listing pages
│       │   ├── countries/        # Country listing pages
│       │   └── places/[slug].astro  # Individual listing detail pages
│       └── components/
│           └── PlaceCard.astro
└── workers/                      # Cloudflare Worker (API + Admin)
    ├── wrangler.toml
    ├── package.json
    ├── migrations/               # D1 SQL migrations (applied in order)
    │   ├── 0001_initial_schema.sql
    │   ├── 0002_seed_categories.sql
    │   ├── 0003_seed_admin_user.sql
    │   ├── 0004_add_place_type.sql
    │   ├── 0005_submissions_enhancements.sql
    │   └── 0006_fts5_search.sql
    └── src/
        ├── index.ts              # Router entry point — all API + admin routes
        ├── auth.ts               # PBKDF2 password hashing, session helpers, API key auth
        └── admin.ts              # Admin panel HTML (server-rendered)
```

---

## Local development setup

### Prerequisites

- Node.js 20+
- A Cloudflare account (free tier is sufficient)

### 1. Install dependencies

```bash
# From the repo root
npm install

# Worker has its own node_modules
cd workers && npm install && cd ..
```

### 2. Set up the local D1 database

```bash
cd workers

# Create the D1 database in Cloudflare (only needed once for remote)
npx wrangler d1 create halal-directory

# Copy the returned database_id into workers/wrangler.toml [d1_databases]

# Apply all migrations to the LOCAL database
npx wrangler d1 migrations apply halal-directory --local
```

The last migration seeds a default admin user and the category list.

### 3. Run the Worker locally

```bash
cd workers
npx wrangler dev
```

The API and Admin panel are served at `http://localhost:8787`.

### 4. Run the Astro site locally

```bash
cd site
npm run dev
```

The site is served at `http://localhost:4321`.  
The Astro dev server proxies API requests to the Worker running on port 8787 via `PUBLIC_WORKER_URL=http://localhost:8787`.

---

## Environment variables

### Worker secrets

Set once per environment with `wrangler secret put <NAME>`:

| Secret | Required | Description |
|--------|----------|-------------|
| `ADMIN_SESSION_SECRET` | Yes | Random string used to sign admin session cookies |
| `CLOUDINARY_CLOUD_NAME` | Yes | Your Cloudinary cloud name (e.g. `my-cloud`) |
| `CLOUDINARY_API_KEY` | Yes | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Yes | Cloudinary API secret |
| `TURNSTILE_SITE_KEY` | Yes | Cloudflare Turnstile **site key** (injected into the submission form) |
| `TURNSTILE_SECRET_KEY` | Yes | Cloudflare Turnstile **secret key** (server-side token verification) |

```bash
cd workers
wrangler secret put ADMIN_SESSION_SECRET
wrangler secret put CLOUDINARY_CLOUD_NAME
wrangler secret put CLOUDINARY_API_KEY
wrangler secret put CLOUDINARY_API_SECRET
wrangler secret put TURNSTILE_SITE_KEY
wrangler secret put TURNSTILE_SECRET_KEY
```

### Astro build-time variables (Pages / GitHub Actions)

| Variable | Required | Description |
|----------|----------|-------------|
| `PUBLIC_WORKER_URL` | Yes | Base URL of the deployed Worker (e.g. `https://halal-directory-api.<account>.workers.dev`) |

### GitHub Actions secrets

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with Pages deployments permission |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `PUBLIC_WORKER_URL` | Same as above — passed as build-time env var |

---

## D1 database setup

### Create the database (first time only)

```bash
cd workers
npx wrangler d1 create halal-directory
```

Copy the `database_id` printed by the command and paste it into `workers/wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "halal-directory"
database_id = "<paste-your-id-here>"
```

### Apply migrations

```bash
# Local development
npx wrangler d1 migrations apply halal-directory --local

# Remote (production)
npx wrangler d1 migrations apply halal-directory --remote
```

Migrations are applied in filename order. Running the command is idempotent — already-applied migrations are skipped.

### Seed data

Migration `0002_seed_categories.sql` inserts the default category list.  
Migration `0003_seed_admin_user.sql` inserts a default admin user:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin123` |

**Change this password immediately after first login in any non-local environment.**

---

## Cloudinary setup

1. Create a free [Cloudinary](https://cloudinary.com) account.
2. From the Cloudinary dashboard, note your **Cloud name**, **API key**, and **API secret**.
3. Set them as Worker secrets (see the table above).

The Worker uploads images directly to Cloudinary using a signed server-side request — no browser-to-CDN upload, no public upload preset required.

Photo management is available in the admin panel at `/admin/places/:id/edit` → **Photos** section:

- **Upload** — multipart POST to the Worker → signed upload to Cloudinary; `cloudinary_public_id` is saved in the `photos` table.
- **Delete** — calls Cloudinary `/image/destroy` then removes the row.
- **Reorder** — ↑ / ↓ arrows swap `sort_order` between adjacent rows.

---

## Turnstile setup

1. Open the [Cloudflare Turnstile dashboard](https://dash.cloudflare.com/?to=/:account/turnstile) and create a new widget (Managed mode recommended).
2. Add your site's domain to the widget's allowed hostname list.
3. Copy the **Site key** and **Secret key**.
4. Set them as Worker secrets:

```bash
cd workers
wrangler secret put TURNSTILE_SITE_KEY    # paste the site key (public)
wrangler secret put TURNSTILE_SECRET_KEY  # paste the secret key (private)
```

The Astro submission page (`/submit`) reads `TURNSTILE_SITE_KEY` from the Worker at SSR time and injects it into the widget's `data-sitekey` attribute.

**Local development:** if `TURNSTILE_SECRET_KEY` is not set, the Worker skips token validation so you can test the submission flow end-to-end without a real widget.

---

## AdSense setup

AdSense ad units are placed in three locations. Replace the placeholder values before going live:

| File | Location | Slot placeholder |
|------|----------|-----------------|
| `site/src/layouts/Base.astro` | `<head>` script tag | `ca-pub-XXXXXXXXXXXXXXXX` (publisher ID) |
| `site/src/pages/index.astro` | Leaderboard (728×90) below hero | `ca-pub-XXXXXXXXXXXXXXXX` + `PLACEHOLDER_LEADERBOARD` |
| `site/src/pages/places/[slug].astro` | Rectangle (300×250) in sidebar | `ca-pub-XXXXXXXXXXXXXXXX` + `PLACEHOLDER_RECTANGLE` |
| `site/src/pages/categories/[category]/index.astro` | Rectangle (300×250) in sidebar | `ca-pub-XXXXXXXXXXXXXXXX` + `PLACEHOLDER_RECTANGLE` |

1. Sign up for [Google AdSense](https://adsense.google.com/) and get your publisher ID (`ca-pub-XXXXXXXXXXXXXXXX`).
2. Create ad units in the AdSense dashboard and note each unit's **Ad slot ID**.
3. Search-and-replace every `ca-pub-XXXXXXXXXXXXXXXX` with your real publisher ID.
4. Replace `PLACEHOLDER_LEADERBOARD` and `PLACEHOLDER_RECTANGLE` with the real slot IDs from your ad units.
5. Also update `site/public/ads.txt` with your publisher ID.

---

## GitHub Actions deployment

The workflow at `.github/workflows/deploy.yml` runs on every push to `main` (and can be triggered manually).

```
push to main
    │
    ├── npm ci                        (install root + site deps)
    ├── npm run build                 (Astro build → site/dist/)
    │   └── env: PUBLIC_WORKER_URL    (injected from GitHub secret)
    └── wrangler pages deploy         (upload site/dist to Cloudflare Pages)
        └── project: halal-directory
```

Required GitHub repository secrets:

| Secret | Where to get it |
|--------|----------------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token (use "Edit Cloudflare Pages" template) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → right-hand sidebar |
| `PUBLIC_WORKER_URL` | The URL of your deployed Worker |

The Worker is deployed separately:

```bash
cd workers
npx wrangler deploy
```

---

## Admin panel

The admin panel is served by the Worker at `/admin/*` — it is **not** part of the Astro build.

| URL | Description |
|-----|-------------|
| `/admin/login` | Login form |
| `/admin` | Dashboard |
| `/admin/places` | Manage listings (create, edit, publish, delete) |
| `/admin/places/:id/edit` | Edit a listing + manage photos |
| `/admin/submissions` | Review public submissions (approve / reject) |
| `/admin/users` | Manage admin users |
| `/admin/api-keys` | Manage API keys |

### First login

Use the seeded credentials:

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `admin123` |

**Change this password immediately** — navigate to the admin users page and update the password for the `admin` account.

### Creating additional admin users

1. Log in as an existing admin.
2. Navigate to **Users** (`/admin/users`).
3. Click **+ New User**, fill in the username and password, and save.

---

## API keys (programmatic access)

Two auth methods are supported:

- **Admin session** — cookie-based (`HttpOnly`, `SameSite=Strict`, 7-day expiry). Issued by `POST /admin/login`.
- **API key** — `Authorization: Bearer <key>` header. Keys are stored hashed (SHA-256) and scoped.

### Creating an API key

1. Log in to the admin panel → **API Keys** (`/admin/api-keys`).
2. Click **+ New API Key**, enter a label (e.g. `content-agent`), and select scopes (`places:read`, `places:write`).
3. Copy the raw key immediately — it is shown **once only**.

### Using an API key

```bash
# List published places
curl https://<your-worker>/api/places \
  -H "Authorization: Bearer <api_key>"

# Create a place
curl -X POST https://<your-worker>/api/places \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Zaytoun","slug":"zaytoun","city":"London","country":"GB","place_type":"restaurant","published":true}'

# Update a place
curl -X PATCH https://<your-worker>/api/places/42 \
  -H "Authorization: Bearer <api_key>" \
  -H "Content-Type: application/json" \
  -d '{"halal_certified":true}'

# Full-text search
curl "https://<your-worker>/api/search?q=chicken+london"
```

An invalid or revoked key returns `401 Unauthorized`. A key without the required scope returns `403 Forbidden`.

---

## Deployment checklist (zero to live)

Follow these steps in order for a fresh deployment.

### 1. Cloudflare account

- [ ] Create a Cloudflare account (free tier is fine)
- [ ] Note your **Account ID** from the dashboard sidebar

### 2. Cloudinary

- [ ] Create a Cloudinary account
- [ ] Note your **Cloud name**, **API key**, and **API secret**

### 3. Turnstile

- [ ] Create a Turnstile widget in the Cloudflare dashboard
- [ ] Add your domain to the allowed hostnames
- [ ] Note the **Site key** and **Secret key**

### 4. D1 database

```bash
cd workers
npx wrangler d1 create halal-directory
# → copy database_id into wrangler.toml
```

### 5. Worker — apply migrations

```bash
npx wrangler d1 migrations apply halal-directory --remote
```

### 6. Worker — set secrets

```bash
wrangler secret put ADMIN_SESSION_SECRET   # generate with: openssl rand -hex 32
wrangler secret put CLOUDINARY_CLOUD_NAME
wrangler secret put CLOUDINARY_API_KEY
wrangler secret put CLOUDINARY_API_SECRET
wrangler secret put TURNSTILE_SITE_KEY
wrangler secret put TURNSTILE_SECRET_KEY
```

### 7. Worker — deploy

```bash
npx wrangler deploy
# → note the worker URL (e.g. https://halal-directory-api.<account>.workers.dev)
```

### 8. AdSense (optional)

- [ ] Replace all `ca-pub-XXXXXXXXXXXXXXXX` placeholders in `site/src/`
- [ ] Replace `PLACEHOLDER_LEADERBOARD` and `PLACEHOLDER_RECTANGLE` slot IDs
- [ ] Update `site/public/ads.txt`

### 9. Astro site — build and deploy

```bash
cd site
PUBLIC_WORKER_URL=https://<your-worker-url> npm run build
npx wrangler pages deploy dist --project-name=halal-directory
```

Or push to `main` — GitHub Actions handles the build and deploy automatically.

### 10. GitHub Actions secrets

Add these in your repository's **Settings → Secrets and variables → Actions**:

| Secret | Value |
|--------|-------|
| `CLOUDFLARE_API_TOKEN` | Token with Pages Edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `PUBLIC_WORKER_URL` | Your deployed Worker URL |

### 11. Post-launch

- [ ] Log in to `/admin` with `admin` / `admin123` and change the password
- [ ] Verify the sitemap is reachable at `/sitemap.xml`
- [ ] Check `robots.txt` resolves and `Disallow: /admin` is present
- [ ] Confirm Turnstile works on the `/submit` page
- [ ] Submit a test listing and approve it from the admin panel

---

## Authentication

Password hashing uses PBKDF2-SHA256 (100,000 iterations, 32-byte key) via the Web Crypto API.

Session cookies are `HttpOnly`, `SameSite=Strict`, and expire after 7 days.
