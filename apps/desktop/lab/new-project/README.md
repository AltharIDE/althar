# The new project lab

Making a project from the app, on whichever home the window is on, in four directions, and Settings on a new home as proposed. It runs on the whole desktop app in the browser: its router, tabs and real screens, on a made-up home with no runtime (`world.ts`: runner-1, a Linux server with no projects, or this Mac with one; your repositories on GitHub; folders found on the home's disk; what the home has signed in and installed). Making a project is a job the home runs step by step (`makeOnHome`), with the clone's progress, and once it's there every read says so.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/new-project/vite.config.ts
```

At `http://localhost:6188`. The bar along the bottom, or its keys, swaps the direction in place: `A`–`D`. `H` starts over on the other home (runner-1, this Mac), `T` dark, `N` the app's narrowest window, `F` makes the next clone drop partway, `S` shows Settings as it is today rather than as proposed, `R` starts over. The address keeps it all: `?d=b&home=runner&theme=dark`, `?d=c&home=mac`, `#/settings/tasks`.

Seams, all in `vite.config.ts`: the start screen and the New project tab are the lab's (`StartView.tsx`, `NewProjectView.tsx`); the tab bar's + and ⌘N, and Manage homes' line for a home with no projects, start the direction's flow; the Settings page takes its side's groups, each section's line and a card for the home from `settings.tsx`.

## The directions

- **A · New project page.** Today's New project tab (the kit's `NewProject` screen), the same on every home: name and mark on the left, where its code comes from on the right, in the home's words (a clone lands on runner-1, a folder is one found there or typed by its path, a new repository is made there). Under it, what runner-1 has and lacks, each with its press (below). Create ticks the home's steps in place, the clone's progress on its card, and lands on the project's own tab.
- **B · Guided steps.** A dialog drawn as Connect a home is: where the code comes from on the left of its drawing board, runner-1 on the right, the line drawn as the code travels. One question a page: which way, which repository or folder, the name and colour, then what runner-1 has and lacks, then its steps as it makes it, and Open. Closed while it's made, it goes on.
- **C · Pick and go.** The empty home is the picker: your repositories, found as you type or by a pasted URL, a folder there, or a name to start empty. One press makes the project, named and coloured from what was picked, and the window is on it at once; the home's clone is one line in its conversation, kept up to date, the composer ready meanwhile. A clone that drops is tried again by itself. Nothing is asked first: a sign-in it lacks is asked for when work needs it.
- **D · Agent sets it up.** The empty home is a composer: say where its code is and what it's for. The project is made at once and an agent on the home does the setup in the open: clones, installs what the home lacks (a toolchain, Docker for your MCP server), runs the tests once and records the setup, so every task after starts ready.

## Settings on a new home

**Today.** Every home keeps its own of everything: its own settings rows, presets, accounts, connections, MCP config and skills (`althar.sqlite` and the home's own `~/.claude.json`, `~/.codex`). Nothing comes over from this Mac, and nothing copies between homes. A window on runner-1 connects with socket authority (`DevicePairings.ts`, `main/homes/controller.ts`), so it can read Settings there but every change, connection and sign-in is refused (`socketCalls`, `packages/contracts/src/Api.ts`). The page doesn't say any of that, and calls runner-1's section "Work on this Mac" (`S` on the bar shows it).

**Proposed: three owners, named in the page.** The same page and sections, grouped down the side by whose each setting is, with the section's line saying so:

| Whose | What | On a new home |
| --- | --- | --- |
| **Yours**, on every home | Tasks and presets, pull requests, the models you choose, MCP servers (which ones, their commands and URLs), skills | There from the start, kept in step. Nothing to bring. |
| **The home's** | Agents signed in there, code hosts connected there, how much it runs at once, its task folders, what's installed | Signed in there, never copied: one press each, approved in your browser on this Mac (device code, or the callback forwarded). A tool your MCP server needs is installed there. |
| **This Mac's** | Notifications and sound, appearance, editor and browser, dictation, keep awake | Stays with the window, whichever home it's on. |

A home that lacks something work needs says so where it matters: a card over Settings' side, the "On runner-1" list in A, B's Ready page, C's conversation when blocked, D's agent. API keys you typed into Althar are the one secret worth offering to send, sealed, on your word ("Use the same key"); vendor sign-in caches never travel (ADR-103).

**Why this holds when cloud comes.** "Yours" belongs to the person, not a machine: keep it as one versioned set keyed by the person's identity, with a keeper that homes follow by digest (ADR-103 already proposes this for MCP servers and skills). Today the keeper is this Mac's runtime; with an account, it's the cloud, and every home (this Mac, runner-1, a cloud worker) follows it the same way. A cloud worker is just a home with its own sign-ins and tools, read by the same list. Nothing in the page changes when the keeper moves.

## What it takes underneath

Common to every direction, and to Settings on a home:

1. **A paired window that can give your word.** None of this runs on runner-1 today: `CreateProject`, every `Set*`, connections and sign-ins aren't in `socketCalls`. Protected enrollment for a paired device (foundations.md says it hasn't shipped) comes first.
2. **Sign-ins made on the home, approved from this Mac.** The host passes no `clientIds` (so no GitHub/GitLab device flow there) and no `openUrl` (`apps/host/src/home.ts`); the window would open the verification page on the Mac. Claude Code and Codex sign in with their device or pasted-code ways on the host.
3. **The home's disk, read on the home.** Folder picking and finding repositories live in the desktop's main process (`main/repositories.ts`) and the folder picker is off on a remote home (`homeConnection.ts`): move finding into the runtime, and take a typed path under your word.
4. **Clone progress.** `cloneInto` (`runtime/src/git.ts`) clones with the home's connection but reports no progress; A–C's progress wants it streamed.
5. **Yours / home / window on every setting.** Tag each setting with its owner, keep yours as one set followed by digest, and group the page by it.

Then per direction: **A** reuses the New project tab nearly as is. **B** is a new dialog beside Connect a home's, a second way to make a project. **C** makes the project at once and the clone after (the project exists before its code: a project state for "code on its way", and the board and composer working before it lands). **D** is C's instant project plus an agent turn as its first, which the task-setup recording mostly has; it costs an agent run per project.

## Pick

**C, with A's list.** Pick and go is the one that answers a press at once (the window is on the project before the clone is done), and asks nothing it doesn't need: on a fresh home, its page shows A's "On runner-1" list under the picker, and anything left is asked for when work needs it. D's agent setup is worth keeping as what the coordinator does on a home that lacks a toolchain, not as the way in. And Settings grouped by whose each setting is, on every home, with yours kept in step rather than copied.
