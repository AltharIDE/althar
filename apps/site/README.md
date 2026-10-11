# @althar/site

The site for Althar. A Vite+ React app, styled with CSS Modules, using `@althar/ui` for the product's own marks, logo, tokens and cards.

The page at `/` is for developers who code with agents today: one app for the coding agents they already pay for, a coordinator that hands out the work, and tasks that review and fix themselves. It doesn't pitch project knowledge or talk like an enterprise. `/shifts` is the running list of what changed under those developers (new models, limits, owners and terms), each entry dated and sourced. `/thesis` is `THESIS.md`, set for reading. `/about` says why we built Althar, the four things we hold to while we build it, and who we are. `/wallpaper` offers Aurora, the light the app opens in, as a wallpaper. `/enterprise` keeps the earlier page (the building site in 3D) for the later company version; nothing links to it.

It is a prototype. Nothing is prerendered yet, and the copy will change.

## Run

From the repository root, run `bun install`. Then run these from `apps/site`:

| Command | Purpose |
| --- | --- |
| `bun run dev` | Development server at `http://localhost:5320` |
| `bun run build` | Production build into `dist/` |
| `bun run preview` | Serve the build at `http://localhost:4320` |
| `bun run check` | Format, lint and TypeScript checks |
| `bun run test` | Unit tests (`tests/`) |
| `bun run og` | Draw the link-preview images into `public/og/` |

`?t=6.5` in the address holds every timeline on the page at that second, for looking at one frame. The coordinator's plan card keeps its own clock, as it does in the app.

## Deploying

`dist/` is static: `index.html` for the developer page, an `index.html` each for `shifts/`, `thesis/`, `about/`, `wallpaper/` and `enterprise/`, the wallpapers' files in `wallpaper/` beside its page, and `assets/`. Each page's HTML carries its own title, description and link-preview tags, from `src/content/pages.ts`; `enterprise/` is marked `noindex`. `wrangler.jsonc` deploys it to Cloudflare as static assets, with no Worker code; any other path gets the developer page.

Set `SITE_URL` (the public origin, such as `https://example.com`) as a build variable, and the preview image and `og:url` become absolute, as X, Slack and LinkedIn want them. Without it the image is a path.

On Cloudflare (Workers Builds), connected to this repository:

| Setting | Value |
| --- | --- |
| Root directory | `apps/site` |
| Build command | `bun install --frozen-lockfile && bun run build` |
| Deploy command | `npx wrangler deploy` (the default) |

From a machine logged in with `bunx wrangler login`, `bun run deploy` builds and deploys the same way.

## Where things live

- `src/App.tsx`: the pages by path. The thesis and the enterprise page load only on their own paths.
- `src/home/`: the developer page.
  - `Home.tsx`: the page, top to bottom: the cobalt first screen, what it signs in with, why more than one agent, the coordinator, one task's loop.
  - `Meters.tsx`: the first screen's card: your plans' usage, and a task moving to Codex when Claude hits its limit.
  - `Why.tsx`: the rolling "best coding agent right now", three reasons with small working pictures, and a ticker of the latest shifts.
  - `Coordinator.tsx`: a chat and the product's own `TaskLaunch` card, which starts on its own and becomes a `TaskCard`.
  - `TaskLoop.tsx`: one task's steps with the review loop; a list on narrow screens.
- `src/about/`: the about page. `About.tsx` is the page, top to bottom: the first screen (`Opening.tsx`: a wall of a dozen terminals, drawn from `wall.ts`, falls quiet and the light rises), why we built it, the four things we hold to in columns of the light, and the team, each signing in the footer's ink (the signature face is Mrs Saint Delafield). `parts.tsx` holds what its sections share: the rise-in once seen, the light's columns in CSS, and the clock its first screen keeps.
- `src/wallpaper/`: the wallpaper page: Aurora, the launch's light held still, in light and dark, each with the phone's beside it and its files to download. The footer links to it.
- `src/shifts/`: the shifts page (`Shifts.tsx`) and the ordering and grouping both pages use (`group.ts`).
- `src/shared/`: the developer pages' bar (`Bar.tsx`), their cobalt end with the wordmark (`Close.tsx`), and the agents' marks (`AgentMark.tsx`). `Masthead.tsx` and `sheet.tsx` belong to the enterprise page and the thesis.
- `src/enterprise/`: the earlier page, unchanged: the 3D site in `scene/`, and its body.
- `src/thesis/`: the thesis. `prose.tsx` compiles `THESIS.md` with `marked` into the site's own elements, with no HTML passed through. Edit `THESIS.md`, not the page.
- `src/content/`: what the site says. `home.ts` is the developer page's copy, `about.ts` the about page's (the story, the principles and the team), `agents.ts` the agents Althar runs and how they sign in, `shifts.ts` the shifts with their sources, `pages.ts` each page's title and description, and `facts.ts` the links and install lines. The enterprise page's content is `meridian.ts`, `site.ts` and `sheet.ts`. Change the facts here, not in a component.
- `src/lib/`: `motion.ts` (the timeline player and easing), `useCurrent.ts` (which part is on screen), `meta.ts` (writes a page's meta into its HTML at build), `cx.ts`.
- `/wallpaper/<file>.jpg`: the wallpapers, which are the brand pack's (`brand/export/wallpaper`). They aren't kept here: `vite.config.ts` serves them from there in development and copies them into `dist/wallpaper/` in the build. Draw them with `bun --filter @althar/brand export:wallpapers`, then copy its `aurora-card.png` to `public/og/wallpaper.png`. `tests/wallpaper.test.ts` fails if the page links a file the pack doesn't have, or if the card differs.
- `src/og/`: the link-preview cards, drawn as the footer's print: the words in cobalt ink over the engraving, with the altar's light rising beside them. `cards.tsx` holds each card's words. In development, `/og?page=home` shows one card on its own, and `/og` shows them all; the route isn't in the build.
- `public/og/`: the link-preview images, 1200×630. `bun run og` draws `home.png`, `shifts.png`, `thesis.png` and `about.png` from `src/og/` (at twice the size, scaled down, as palette PNGs); run it after changing a card's words or the engraving. `/docs` and `/enterprise` use the home card; `wallpaper.png` is the brand pack's.

The developer page's drafts are in `althar-designs/althar-dev/` (`a.html` is the one this page follows). The enterprise page's earlier concepts are archived in `althar-designs/prototypes/_archive/landing-concepts-2026-09-29/`.

## Before this ships

- Bring Gemini back into the headline, the cards and `agents.ts` once Althar runs it (it isn't in the agent registry yet).
- Check every shift against its source, and swap secondary sources for the company's own post where there is one (see the note at the top of `content/shifts.ts`).
- Replace the placeholders in `facts.ts`: the release link, the Homebrew cask and the clone URL.
- Set `SITE_URL` in the Cloudflare build settings once the domain is chosen, so link previews show the image.
- Re-check that Claude plans may still be used through third-party apps; the page's first claim depends on it.
- Prerender it, as the pitch app does, so the page reads without JavaScript.
- Split the main bundle further; most of it is `@althar/ui`.
- Check the links against the real repository: `facts.ts` still points at thetastemakers/althar, which GitHub redirects to AltharIDE/althar.
