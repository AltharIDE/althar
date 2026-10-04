# Pitch architecture

This is the durable target for `@althar/pitch`, under the repository-wide [architecture](../../ARCHITECTURE.md). The site is a self-contained public document. Its job is to explain Althar's thesis in a short brief and a longer research note. It does not own accounts, user data, or backend state. Repository maintainers own this app.

## Pages and data flow

`src/meta.ts` declares the brief, research, and 404 pages. `src/paths.ts` maps the current path to one of them and supplies base-aware links. `src/App.tsx` is the single page selector and skip link. The brief lives in `src/pages/brief/`; its model files hold figure data and pure calculations. The research note lives in `src/pages/research/`. Shared components and utilities stay in `src/components/` and `src/lib/`.

The production build compiles the client, compiles `src/entry-server.tsx` for rendering, and runs `scripts/prerender.ts`. The prerenderer fills the Vite HTML shell with page metadata from `config/seo.ts` and complete React markup. `src/entry-client.tsx` hydrates that markup; in development it renders into the empty shell. Use normal links for navigation so the document works without JavaScript, including when opened directly at `/research/` or `/404.html`.

Build inputs (`SITE_URL`, `SITE_NOINDEX`, and `BASE_PATH`) are validated or normalized at the build boundary. No runtime API or persistence layer is present. Browser effects stay in page components and scroll helpers; they do not change the page's essential text or links.

## Accessibility and failure behavior

The full argument, figures' text alternatives, navigation, and table of contents must be available in prerendered HTML. JavaScript only adds progress indicators, reading position, and optional figure motion. Reduced-motion settings and layouts that cannot pin a slide show its complete final state. Keyboard users can reach and scroll overflow regions; every page has one working skip link and a main landmark.

An unknown route renders the 404 document with a route back to the brief. A failed client script must leave the document readable. A missing required build slot or invalid deployment origin fails the build instead of silently publishing incomplete metadata. Hosting-specific headers and 404 routing must be configured when deploying outside Netlify or Cloudflare Pages.

## Performance and verification

The initial budget is **120 KiB gzip for the client JavaScript** and **20 KiB gzip for CSS**. `scripts/budget.ts` checks these during every production build. Keep third-party runtime dependencies and image transfer small. Compare real browser behavior at mobile and desktop widths when changing scroll or media code.

`bun run check` gates formatting, type-aware linting, and strict TypeScript. `bun run test:coverage` requires at least 90% line and branch coverage of `src/` and `config/`. Tests cover route selection, prerendered content, page interactions, metadata, figure models, and SEO rules. `bun run test:e2e` runs against the built output and checks direct routes, hydration, console errors, navigation, no-JavaScript content, accessibility, and responsive overflow. CI runs all of these checks and uploads the built site only after they pass.

## ADR log

### ADR-001 — 2026-09-22: Static prerender with one page selector

- **Status:** Accepted
- **Owner:** Repository maintainers
- **Context:** The brief and research note need direct URLs, complete no-JavaScript content, and predictable hydration. Client router and prerender route handling had diverged.
- **Decision:** Use one base-aware path selector for both server rendering and client hydration. Generate three static documents and use native links between them.
- **Alternatives considered:** A client router with route-aware SSR, or separate application entry points. Both add machinery for two content pages and make the rendered and hydrated trees easier to diverge.
- **Trade-off:** Navigation reloads a document. For this small site, the simpler route and failure model is preferable.
- **Revisit when:** The site acquires substantial interactive navigation or user state that must survive page transitions.
