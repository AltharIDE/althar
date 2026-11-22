# The What's new lab

Four takes on a What's new page inside Althar, after an update: where it lives and how it shows up the first time the window opens on a new version; three looks for the page itself; and three for Coming next, the roadmap beside it. On the whole desktop app in the browser, its router, tabs and real screens, on made-up data with no runtime (the conversation bar lab's world, `data.ts`), just restarted into 0.10.0. The notes are the real ones: `changelog.ts` is the site's `apps/site/src/content/changelog.ts` as it stands on #1097's branch, with 0.10.0 led by "Your own host, your own workers".

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/whats-new/vite.config.ts
```

At `http://localhost:6183`. The bar along the bottom, or its keys, swaps the direction in place, each opening as the window would on its first launch after the update: `A`–`D`. `R` updates again (the arrival once more). `1`–`3` switch the page's look, in every direction, and open it. `4`–`6` open Coming next in each of its looks, in every direction: D's bar switches to it, and elsewhere it opens in What's new's place, with a crumb (or `Esc`) back. `F` says the person updated from 0.8.0, so 0.9.0 is new to them too. `N` narrows the window to the app's narrowest (880 px). The address keeps it, and opens a state for a screenshot: `?d=b&look=live#/whats-new`, `?d=c&notes=1&look=log`, `?d=d&view=coming&coming=workshop#/whats-new`, `?d=a&view=coming&coming=shape#/whats-new`.

The version line in the quick settings' foot and in About Althar opens What's new in the window in every direction, rather than the site in the browser: once its tab is closed, that is the way back.

## The directions

- **A · Opens as a tab.** The window opens on a What's new tab beside the home's, as Settings' tab sits: Althar's own, no project's, with its ×. Closed, it's gone until the next update.
- **B · Offered in the bar.** The window opens where it was. At the bar's end, where "Althar 0.10.0 is ready · Restart" stood before the restart, one quiet line: "Updated to 0.10.0 · What's new", until it's opened. Pressed, the same tab as A's.
- **C · The home says it.** No tab. The window opens on the home, and the home at rest says the update under what it says already: the release's name, a line, What's new. Pressed, the page takes the home's place, with the way back to it.
- **D · Althar, like a project.** A tab of Althar's own, kept like a project's, beside the home's, with a quiet dot (the kit's "something new there", not violet) after an update until it's opened. Its page has a project's bar, with two views: What's new, the page; Coming next, the roadmap, in the look `4`–`6` pick.

## The looks

Each ends on the same foot (`parts.tsx`): every change in 0.10.0, then the releases before, each opening in place, and the site's changelog for the rest.

- **1 · Light** (`looks/Launch.tsx`). The release opens on Althar's own light, the kit's `Light` the launch and the home at rest stand on, with the mark coming up in halftone: the version it came from and the flagship large over it, no buttons. Then where the work runs now, one picture (`looks/Where.tsx`): the laptop, the home on a server and two workers, drawn as machines, a task going between them along the wires; the laptop closes and the work goes on, and it opens again on the finished task. Then the rest of what's new as tiles, each with a small picture in the app's own marks and type (the computer-use ask, a board pointed at, `/goal`, the agents' marks, a terminal, the tools work comes in from); four things that feel better; where to follow what's next (GitHub, X, LinkedIn) on the light again, with the way to Coming next; and every release.
- **2 · The real thing** (`looks/Live.tsx`). Each feature shown by the kit's own component, live, on a stage beside its words: the task launch with Run on Best available worker; the ask to use the computer's apps; a canvas line and the composer holding comments pointed at it; Goal; the agent catalog; the window's foot with a terminal drawer up.
- **3 · Flight log** (`looks/Log.tsx`). The site's changelog, in the window: the site's own night page (`apps/site/src/shared/night`), its readouts saying what you updated from, the release large over its living picture of the home and the worker, then the log, the releases new to you lit, with the site's pictures and runs of changes. The pictures and the log's styles are copied from #1097's branch into `looks/site/`, their imports pointed at the site's sources on main.

## Coming next

The roadmap is the site's (`ROADMAP` in `changelog.ts`): two things being built now, two next, two later. `looks/coming/roadmap.ts` gives each what the lab makes up for it: its picture, a branch, and how many want it. No dates. Each thing has a picture of it working (`looks/coming/Pictures.tsx`), a short loop in the app's own marks: the installer's publisher going from unknown to Althar, verified; a pull request opening and an automation starting a review; an ask allowed from a phone; a lead tapping through checkout on a simulator; a project's notes, each with its source, read by every agent; a team on one project with a hosted agent. With motion reduced, each stands on how it ends.

- **4 · Horizon** (`looks/coming/Horizon.tsx`). Launch-grade, on Althar's light as What's new's Light is: what's next, large; what's being built now as wide cards, the thing working beside its words; next, side by side; later, dimmer, standing on the light again at the foot, with where to say what you'd want first.
- **5 · The workshop** (`looks/coming/Workshop.tsx`). The roadmap as Althar's own project, built in Althar: its board, in the kit's own lanes and cards. What's being built now runs, its lead and step on each card (the automations' lead hands it to review a moment after it opens); next and later wait up next; Needs you holds a question for the person, on which event should start an automation first; Settled holds what 0.10.0 merged. Over it, a live line of what the work does.
- **6 · Shape it** (`looks/coming/Shape.tsx`). Each thing as a card with its picture, the most wanted first and largest, each with Want this, which counts the person in at once: the count turns over and a +1 rises. Pressed again, it takes it back. Cards keep their places while the page is open. Then where to say what's missing: GitHub's issues, or Discord.

## How it's built

Three seams in `vite.config.ts`, and the rest is the app's own. The window's bar, the quick settings and Settings take the kit through `ui.ts`: `LabTabs.tsx` gives the tabs the What's new tab or line, and `LabVersion.tsx` points the version line's What's new into the window. The home at rest takes `HomeRest.tsx`, which adds C's lines. The kit's `ProjectTabs` gets one more pinned tab after Settings' (`whatsNew`), drawn as Settings' tab is, by a transform of its source. What's new's page is a route of the lab's own, `/whats-new`, under the app's tabs (`main.tsx`); the page is `WhatsNew.tsx`, which picks the look (and Coming next's), on the kit's components and tokens. The tab's mark is Iconoir's Sparks, which the kit hasn't named yet.

## Screenshots

`shoot.mjs` shoots each direction in each state, the window only, at 1×, into `lab/whats-new/shots` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside:

```bash
node lab/whats-new/shoot.mjs
```

Delete the lab once a direction is picked to build, before building it.
