# Artifact in git lab

Two people's Althars editing one artifact saved in git: noticing someone else changed it (and who), bringing their version in, what the agent and the person each do when both changed it, their edits meeting in one pull request rather than two, and what a designer and an engineer each see. Four directions on the whole desktop app in the browser (its router, tabs and the artifact's own room), on made-up data with no runtime.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/artifact-git/vite.config.ts
```

At `http://localhost:6207` (or Run › Artifact in git lab). The bar along the bottom, or its keys, swaps in place: `A`–`D` the direction, `1`–`4` (or `←` `→`) the moment, `T` dark, `N` the app's narrowest window. Its end says whose Althar the window is. The address opens on one: `?d=b&m=2&theme=dark&narrow=1`. What is pressed in the window (Show, Bring it in, Compare, Use together, Commit, the chat's question, Ask Ana to review) moves the moment on as it would.

## The story

Kiln, a pottery studio's bookings site, keeps its artifacts in `design/` in its one repository, each in a pull request of its own, committed when someone saves. Its Booking page (`design/booking/`) was drawn in Maya's Althar and merged in #214 at v3.

- **Ana**, an engineer, changed it in her Althar: the bookings API's dates, price and places left, and no Gift this class, as the API can't sell gifts yet. Her Althar saved it in **#221**, still open.
- **Maya**, a designer, changed it in hers meanwhile, not knowing: a new heading, Book in a bar with the price beside it, Gift as a button (her v4, not in git yet).

Today, Maya's save would write her files over the folder on main without reading Ana's, and open a second pull request beside #221; neither Althar ever shows the other's version. Moments 1–3 are Maya's Althar; moment 4 is Ana's, after Maya's change reaches #221.

## The directions

- **A · In its versions.** What's in git comes in as a version, in line: "Ana changed it in git: v5", the panel's own "v5 is out" line, and the row says "Ana, in git · 25 min ago". The canvas never moves under the person. On Ana's v5: "your v4 isn't in it", Bring it in, and the chat brings v4 onto it as a stale publish is brought on today (ADR-104), deciding the one clash itself and saying so with an undo ("Gift kept here", Take it out). Saving goes to the artifact's open pull request, whoever opened it; Save to repo lists who is in it. Ana sees Maya's version arrive the same way.
- **B · Side by side.** Their version isn't one of yours until you take it: "Ana changed it in git", Compare. The canvas shows yours and Ana's small and the two together large, with what differs pinned and listed; the one clash is yours to call on its row. Keep mine, Take Ana's, Use together. Saving offers Ana's open pull request first, or one of its own. Ana, the engineer, gets the same compare, opening on Files: the diff of `index.html`.
- **C · Its chat says.** Althar tells the artifact's chat (a line: "Ana changed Booking page in git · #221"), and it says the rest in words: what she changed, what you changed since, bringing hers in under yours. It asks only what it can't decide, as the thread's question card ("Gift this class: keep it?"), then saves into #221 and says so. Ana's chat tells her Maya's change, with the commit's files, and asks whether to tell the lead of her task that builds the site's page from this design.
- **D · One draft in git.** While an artifact has an open pull request, it is everyone's draft: every Althar shows its head as the latest and pushes each new version into it as it's published, so versions are numbered the same everywhere and there is never a second pull request. The row says who is in the draft (faces) and the canvas line says your changes go in it too. Both changing it at once is rare and brought on by the chat. Handing it on is the draft's: Ask Ana to review, or Merge. Ana sees "In review", the files and Merge.

## What every direction needs underneath

- **Reading git for the artifact's folder.** On each fetch, the commits on the default branch and on open pull requests that change the folder and weren't this Althar's, with who made them (commit author, matched to the code host's login).
- **A version from git.** The folder's files at that commit, kept as a version whose maker is a person "in git" (today `CanvasBy` is only a lead, the coordinator or the chat).
- **One pull request per artifact folder.** Today the branch is named by the canvas's id, which differs between two Althars, and an open pull request Althar didn't open is refused. Instead: continue the open pull request that changes the folder, whoever opened it, bringing the version onto its head (a three-way merge from the last version saved), co-authored.
- **Stale is stale across Althars.** ADR-104 refuses a publish made on a version that isn't the latest; the latest includes git's.

## How it's put together

| The app's file | Takes from the lab | For |
| --- | --- | --- |
| `features/canvases/ArtifactRoom.tsx` | `@althar/ui` → `kit.ts`; `./CanvasHost` → `seams/CanvasHost.tsx` | The room's row says who made the version shown (`ArtifactHead`, wrapped); the app's own CanvasHost, told which version shows |
| `features/canvases/CanvasHost.tsx` | `@althar/ui` → `kit.ts`; `./SaveCanvas` → `seams/SaveCanvas.tsx` | The panel's line over the canvas (`CanvasPanel`, wrapped); the canvas drawn as the design's page, or B's compare (`CanvasPagePlace`); Save to repo, or D's draft |

The design itself is `design.html`, its versions by `?v=`. What the artifact's chat says, and the versions each Althar has at each moment, are in `data.ts`.

## Screenshots

`shoot.ts` shoots every moment, the window at 1×, into `shots/` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside:

```bash
node lab/artifact-git/shoot.ts          # every shot
node lab/artifact-git/shoot.ts b dark   # those whose names start so
```

Delete the lab once a direction is picked to build, before building it.
