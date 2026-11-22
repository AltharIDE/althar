# The What's new lab

Four takes on a What's new page inside Althar, after an update: where it lives, how it shows up the first time the window opens on a new version, and how it reads. On the whole desktop app in the browser, its router, tabs and real screens, on made-up data with no runtime (the conversation bar lab's world, `data.ts`), just restarted into 0.10.0. The notes are the real ones: `changelog.ts` is the site's `apps/site/src/content/changelog.ts` as it stands on #1097's branch, with 0.10.0 led by "Your own host, your own workers".

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/whats-new/vite.config.ts
```

At `http://localhost:6183`. The bar along the bottom, or its keys, swaps the direction in place, each opening as the window would on its first launch after the update: `A`–`D`. `R` updates again (the arrival once more). `1` and `2` switch how A, B and C read: the notes whole, or the highlights first. `F` says the person updated from 0.8.0, so 0.9.0 is new to them too. `N` narrows the window to the app's narrowest (880 px). The address keeps it, and opens a state for a screenshot: `?d=b#/whats-new`, `?d=c&notes=1&read=highlights`, `?d=d&view=coming#/whats-new`.

The version line in the quick settings' foot and in About Althar opens What's new in the window in every direction, rather than the site in the browser: once its tab is closed, that is the way back.

## The directions

- **A · Opens as a tab.** The window opens on a What's new tab beside the home's, as Settings' tab sits: Althar's own, no project's, with its ×. Closed, it's gone until the next update. Reads as the notes, whole: the release's name, its flagship's lines, then Also new, Improved and Fixed.
- **B · Offered in the bar.** The window opens where it was. At the bar's end, where "Althar 0.10.0 is ready · Restart" stood before the restart, one quiet line: "Updated to 0.10.0 · What's new", until it's opened. Pressed, the same tab as A's. Reads as the highlights: the flagship with where the work now runs and its ways in (Connect a home, Add a worker), six things to try, then every change a fold away.
- **C · The home says it.** No tab. The window opens on the home, and the home at rest says the update under what it says already: the release's name, a line, What's new. Pressed, the notes take the home's place, with the way back to it.
- **D · Althar, like a project.** A tab of Althar's own, kept like a project's, beside the home's, with a quiet dot (the kit's "something new there", not violet) after an update until it's opened. Its page has a project's bar, with two views: What's new, every release as a row, the newest open and those new to you saying so; Coming next, the roadmap in lanes, as the board has them.

## How it's built

Three seams in `vite.config.ts`, and the rest is the app's own. The window's bar, the quick settings and Settings take the kit through `ui.ts`: `LabTabs.tsx` gives the tabs the What's new tab or line, and `LabVersion.tsx` points the version line's What's new into the window. The home at rest takes `HomeRest.tsx`, which adds C's lines. The kit's `ProjectTabs` gets one more pinned tab after Settings' (`whatsNew`), drawn as Settings' tab is, by a transform of its source. What's new's page is a route of the lab's own, `/whats-new`, under the app's tabs (`main.tsx`); the page itself is `WhatsNew.tsx`, on the kit's components and tokens. The tab's mark is Iconoir's Sparks, which the kit hasn't named yet.

## Screenshots

`shoot.mjs` shoots each direction in each state, the window only, at 1×, into `lab/whats-new/shots` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside:

```bash
node lab/whats-new/shoot.mjs
```

Delete the lab once a direction is picked to build, before building it.
