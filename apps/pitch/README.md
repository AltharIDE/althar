# @althar/pitch

The Althar brief, research note, and not-found page. This is a static React site in the Bun workspace. Every page is prerendered to complete HTML and then hydrated for scroll interactions.

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the intended boundaries and quality gates.

## Run and verify

From the repository root, run `bun install --frozen-lockfile`. Then run these commands from `apps/pitch`:

| Command | Purpose |
| --- | --- |
| `bun run dev` | Development server at `http://localhost:5290` |
| `bun run build` | Client build, server render, prerender, and asset budget check into `dist/` |
| `bun run preview` | Serve the built site at `http://localhost:4290` |
| `bun run check` | Format, lint, and TypeScript checks |
| `bun run test:coverage` | Unit and component tests with 90% line and branch gates |
| `bun run test:e2e` | Browser, accessibility, no-JavaScript, and responsive checks against `dist/` |
| `bun run verify` | Run all checks and the production build in order |
| `bun run images` | Regenerate optimized screenshots, icons, and the social image |

Install the browser once with `bunx playwright install chromium` before running E2E tests locally.

## Deploy

Publish `apps/pitch/dist/` to a static host. Route unknown URLs to `404.html`. The build requires Bun 1.3.5 and a supported Node release; see the root `.bun-version` and `.node-version`.

| Variable | Effect |
| --- | --- |
| `SITE_URL` | Public origin, such as `https://althar.dev`. Adds canonical URLs, absolute social image URLs, and a sitemap. |
| `SITE_NOINDEX=1` | Keeps a preview deployment out of search results. |
| `BASE_PATH` | Serves the site below a path such as `/pitch/`. |

On Cloudflare, `wrangler.jsonc` serves `dist/` as static assets with the 404 page; build with `bun run build`, deploy with `npx wrangler deploy`, and set `SITE_URL` as a build variable.

`public/_headers` provides security and cache headers on Netlify and Cloudflare. Configure equivalent headers on other hosts. Use HTTPS when deploying with the supplied HSTS and CSP headers.
