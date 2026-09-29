# @charrette/site

Charrette's landing page, and the thesis. A Vite+ React app, styled with CSS Modules, using `@charrette/ui` for the product's own marks, logo and tokens.

The page's idea: agents come and go, the project stays. The first screen is a building site in 3D, drawn on a canvas as a two-point perspective. A tower crane sets a floor per task, a different agent's name on its plate each time, and each floor is a note the project keeps. Below it: what Charrette is, the agents it runs, task 418 as its graph with the review loop, what the project knows, and where it stands. `/thesis` is `THESIS.md`, set for reading.

It is a prototype. Nothing is prerendered yet, there are no tests, and the copy will change.

## Run

From the repository root, run `bun install`. Then run these from `apps/site`:

| Command | Purpose |
| --- | --- |
| `bun run dev` | Development server at `http://localhost:5320` |
| `bun run build` | Production build into `dist/` |
| `bun run preview` | Serve the build at `http://localhost:4320` |
| `bun run check` | Format, lint and TypeScript checks |

`?t=6.5` in the address holds the site's first screen at that second, for looking at one frame.

## Deploying

`dist/` is static: `index.html` for the landing page, `thesis/index.html` for the thesis, and `assets/`. `wrangler.jsonc` deploys it to Cloudflare as static assets, with no Worker code; any other path gets the landing page.

On Cloudflare (Workers Builds), connected to this repository:

| Setting | Value |
| --- | --- |
| Root directory | `apps/site` |
| Build command | `bun install --frozen-lockfile && bun run build` |
| Deploy command | `npx wrangler deploy` (the default) |

From a machine logged in with `bunx wrangler login`, `bun run deploy` builds and deploys the same way.

## Where things live

- `src/App.tsx`: the landing page at `/`, the thesis at `/thesis`.
- `src/home/`: the landing page.
  - `Home.tsx`: the first screen, with the canvas, the floors' notes and the headline.
  - `scene/`: the 3D site. `model.ts` is the building, scaffold and crane in metres; `timeline.ts` is what the crane does each second, with the load's swing as a damped pendulum; `render.ts` projects and paints it. No 3D library.
  - `Body.tsx`: the parts below: what it is, the agents (`Crew.tsx`), task 418 (`TaskGraph.tsx`), what it knows (`Knowledge.tsx`), and where it stands.
- `src/thesis/`: the thesis. `prose.tsx` compiles `THESIS.md` with `marked` into the site's own elements, with no HTML passed through. Edit `THESIS.md`, not the page.
- `src/shared/`: the bar along the top (`Masthead.tsx`), and the drawing set's pieces both pages use (`sheet.tsx`): task 418's keyed steps, the revision block, the stamp, the definition.
- `src/content/`: what the site says. `facts.ts` holds every claim, link and status line; `meridian.ts` the made-up project and task 418; `site.ts` the six tasks the crane builds and their notes; `sheet.ts` the revisions and the definition. Change the facts here, not in a component.
- `src/lib/`: `motion.ts` (the timeline player and easing), `useCurrent.ts` (which part is on screen), `cx.ts`.

The earlier concepts (Set, Cover, Markup, Faces, Stays, Front sheet, Dimensions, Scaffold, Lift, Plan, Axonometric) and the concept browser are archived in `charrette-designs/prototypes/_archive/landing-concepts-2026-09-29/`, with the kits they import.

## Before this ships

- Prerender it, as the pitch app does, so the page reads without JavaScript.
- Choose the licence. The page says it is still to be chosen.
- Check the links against the real repository, which may not be public yet.
