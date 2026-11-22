# The What's new lab

What's new inside Althar, after an update, as the final prototype before sign-off: Althar's own tab, kept like a project's, with two views, What's new and Coming next. On the whole desktop app in the browser, its router, tabs and real screens, on made-up data with no runtime (the conversation bar lab's world, `data.ts`), just restarted into 0.10.0. The notes are the real ones: `changelog.ts` is the site's `apps/site/src/content/changelog.ts` as it stands on #1097's branch, with 0.10.0 led by "Your own host, your own workers". Its roadmap is staged as Linear has it on 22 Nov.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/whats-new/vite.config.ts
```

At `http://localhost:6183`. The window opens where it was, on a project of the person's. The bar along the bottom walks through the rest, with keys too: `R` the update again (the window where it was, Althar's tab with its dot); `1` What's new and `2` Coming next, on Althar's tab; `Q` the quick settings, whose version line says the version and opens What's new, the way back once the update has been looked at; `F` updated from 0.8.0, so 0.9.0 is new to the person too; `N` the app's narrowest window (880 px). The address keeps the state: `?view=coming#/whats-new`, `?from=0.8.0&narrow=1#/whats-new`.

## How it arrives

Althar has a tab of its own, beside the home's, kept like a project's, with the Sparks mark (the logo is the home's). After an update it has a quiet dot (the kit's "something new there", not violet, which is for what needs the person) until it's opened; nothing opens by itself. Its page has a project's bar: Althar, Up to date, and the two views. The version line in the quick settings' foot and in About Althar opens it in the window rather than the site in the browser.

## What's new (`looks/Launch.tsx`)

The release on Althar's own light, the kit's `Light` the launch and the home at rest stand on, with the mark coming up in halftone: the version the person came from and the new one, the date, and the flagship large over it, no buttons. Then where the work runs now, one picture (`looks/Where.tsx`): the laptop, the home on a server and two workers, drawn as machines, a task's current reaching along each wire as the work goes between them; the laptop closes, its screen asleep and its wire to the home gone, and the work goes on; it wakes, the wire back, on the finished task. It plays only on screen, and with motion reduced it rests on the finished task. Then the rest of 0.10.0 as tiles, each with a small picture in the app's own marks and type (the computer-use ask, a board pointed at, `/goal`, the agents' marks, a terminal, the tools work comes in from); four things that feel better; where to follow what's next (GitHub, Discord, X, LinkedIn) on the light again, with the way to Coming next; and every release, each opening in place, the ones new to the person marked.

## Coming next (`looks/coming/Shape.tsx`)

The roadmap (`ROADMAP` in `changelog.ts`) as cards for the person to shape, each with a picture of it working (`looks/coming/Pictures.tsx`): the mobile app largest, being built, 0.11.0's flagship (DEV-131, althar-mobile); next, event-based automations, iOS simulators and project knowledge (DEV-202, DEV-164, DEV-9); later, Windows signing (not in Linear) and teams in the cloud (DEV-130). No dates. No votes yet: each card's Say what you'd need opens a new issue on GitHub with its name filled in, and What's missing points to GitHub's issues and Discord. Votes, when they come, could be 👍 reactions on a roadmap issue each, read from GitHub's public API and added with the GitHub sign-in Althar already has, with no backend of Althar's own.

## How it's built

Two seams in `vite.config.ts`, and the rest is the app's own. The window's bar, the quick settings and Settings take the kit through `ui.ts`: `LabTabs.tsx` gives the tabs Althar's, and `LabVersion.tsx` points the version line's What's new into the window. The kit's `ProjectTabs` gets one more pinned tab after Settings' (`whatsNew`), drawn as Settings' tab is, by a transform of its source. Althar's page is a route of the lab's own, `/whats-new`, under the app's tabs (`main.tsx`); the page is `WhatsNew.tsx`, on the kit's components and tokens. The tab's mark is Iconoir's Sparks, which the kit hasn't named yet. The looks and directions not chosen (where it lives: a closable tab, a line in the bar, the home; how it looks: the real thing, the flight log; Coming next as a horizon or Althar's board) are in the branch's history, up to bad0c376e.

## Screenshots

`shoot.mjs` shoots each state, the window only, at 1×, into `lab/whats-new/shots` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside:

```bash
node lab/whats-new/shoot.mjs
```

Delete the lab once it's built, before building it.
