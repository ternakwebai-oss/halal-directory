# Halal Directory — Site

Astro (SSR) frontend for the Halal Directory, deployed on Cloudflare Pages with D1 database access.

## Commands

Run from `site/`:

| Command           | Action                                   |
| :---------------- | :--------------------------------------- |
| `npm install`     | Install dependencies                     |
| `npm run dev`     | Start local dev server at `localhost:4321` |
| `npm run build`   | Build for production to `./dist/`        |
| `npm run preview` | Preview production build locally         |

## Google AdSense Setup

Ad slot placeholders are in place across the site. Before going live, replace the placeholder values in the files below.

### 1. Replace the Publisher ID in the base layout

**File:** `src/layouts/Base.astro`

Find this line and replace `ca-pub-XXXXXXXXXXXXXXXX` with your real AdSense publisher ID:

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossorigin="anonymous"></script>
```

### 2. Replace slot IDs in each page

Each `<ins class="adsbygoogle">` tag has `data-ad-client` and `data-ad-slot` attributes that need real values.

| Page | File | Slot placeholder | Format |
| :--- | :--- | :--------------- | :----- |
| Homepage (below hero) | `src/pages/index.astro` | `PLACEHOLDER_LEADERBOARD` | Leaderboard 728×90 |
| Category pages (sidebar) | `src/pages/categories/[category]/index.astro` | `PLACEHOLDER_RECTANGLE` | Rectangle 300×250 |
| Listing detail (below description) | `src/pages/places/[slug].astro` | `PLACEHOLDER_RECTANGLE` | Rectangle 300×250 |

For each file, set:
- `data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"` → your real publisher ID
- `data-ad-slot="PLACEHOLDER_..."` → the numeric slot ID from your AdSense account

### 3. How to get slot IDs

1. Log in to [Google AdSense](https://adsense.google.com/).
2. Go to **Ads → By ad unit → Display ads**.
3. Create a new ad unit for each placement (leaderboard, rectangle).
4. Copy the numeric slot ID (e.g. `1234567890`) from the generated code snippet.
5. Paste it into the corresponding `data-ad-slot` attribute.
