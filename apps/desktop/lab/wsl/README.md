# The WSL lab

How someone whose code, agents and sign-ins live in WSL meets it in Althar on Windows, in three directions, on the app's own screens: the first run (`Welcome`), Connect a home and its setup steps (the homes feature's own drawing, steps and styles), the homes chip's menu and Manage homes, a home's first window (`HomeWelcome`), its `Home`, and `New project`, in a window with Windows' own buttons (`ProjectTabs`). Where a screen has no place yet for what WSL adds, the lab puts it there as the slot the screen would grow. Nothing runs: the PC, its distros and its agents are made up (`data.ts`).

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/wsl/vite.config.ts
```

At `http://localhost:6157` (Run › WSL lab). The bar along the bottom, or its keys, swaps in place:

- **A / B / C** the direction
- **1–6** the touchpoint: first run, choosing a distro, setting it up, among the homes, asleep or stopped, the other side's folders
- **X** (Shift+X back) the touchpoint's states, such as each way setting it up can stop
- **T** light or dark

The caption beside the states says what the scene shows.

## The directions

- **A · A home on this PC.** Each WSL 2 distro is a home, like a server, in a window of its own: Connect a home gets a WSL tab first on Windows, and Althar sets the distro up over `wsl.exe` (no SSH, no keys, no systemd, and the host comes from the app on this PC, at its version). In the homes menu, distros sit under On this PC with This PC; servers under Elsewhere.
- **B · One window.** No new home: This PC's projects live on Windows or in a distro and run where their code is. Ubuntu's agents are this PC's agents, each saying where it runs; setting Ubuntu up is a quiet line; a project can't have folders on both sides.
- **C · Work where your code is.** Asked once, on the first run: where you work. Picking Ubuntu makes it the PC's own window, and Windows a home you can open. Althar keeps Ubuntu awake while its window is open, and starts it again by itself where it stopped with work under way.

## The pick

**A's model, with C's first run.** A distro as a home is the honest shape: a home is where the code, the agents and their sign-ins are, and its tasks run there. It reuses all of the homes feature (its windows, chip, Manage homes, setup steps, home welcome) and has the fewest new failure states. But A alone greets a WSL person with an empty This PC ("None yet" for agents), so take C's first run: where Althar finds agents and repositories in a distro, it asks once where you work and opens the window there; Windows stays a home in the menu. From C too: keep the distro awake while a window is on it, not only while tasks run, and start it again where it stopped mid-work (with Keep it stopped in the menu, for a `wsl --shutdown` that meant it).

Not B: one runtime across both sides runs git, worktrees, agents and checks across WSL's file share or through a worker in the distro (the native worker path, not built), a project still needs a rule for folders on both sides (6, B), and every agent named twice (Windows' Claude Code and Ubuntu's) becomes a question in every picker. Its good idea, New project finding repositories in running distros, fits A too.

## What matters, and what the brief left out

In order: the first run on a WSL person's PC (today it looks empty and wrong); setting up and its few real failures (WSL 1, Virtual Machine Platform off, the distro stopping midway, agents not signed in there); a project on the wrong side, a performance cliff nobody explains (`\\wsl$` from Windows, `/mnt/c` from the distro); sleeping and stopping; how it reads among homes, which is small.

Shown here and not in the brief: GitHub and Linear come over from This PC to a home on the same PC rather than being connected again; the host updates with the app, so a same-PC home never needs an update of its own; the home welcome's words promise work goes on "with this PC closed", which WSL can't, and its memory is WSL's share of the PC; Docker Desktop's distros are never listed.

Not drawn: opening a WSL project in File Explorer (`\\wsl.localhost\Ubuntu\…`) or an editor's WSL remote; previews of a dev server in the distro (WSL 2 forwards localhost by default; mirrored networking changes that); forgetting a WSL home, which offers to remove althar-host from the distro and leaves the projects' files.

## Shots

`shoot.ts` shoots every scene headless at 1×, light and dark, into `lab/wsl/shots` (git ignores it), with `shots.md` their captions in order; `sheet.ts` lays some side by side at half size. With the lab running, outside an agent's sandbox (Chromium can't start in it on a Mac):

```bash
node lab/wsl/shoot.ts            # or a filter: 3-a, -b-
node lab/wsl/sheet.ts sheet.png 1- 2-
```
