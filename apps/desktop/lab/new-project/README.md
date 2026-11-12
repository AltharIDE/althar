# The new-project lab

Setting up a project in a folder with no remote, on the kit's real screens and cards, with no runtime.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/new-project/vite.config.ts
```

At `http://localhost:6163`. Step one is the New project page as it is, taking any folder. Create opens the project, and its first conversation offers what it still needs: git where it has none, where its code lives (GitHub, GitLab, or only this computer), and where its issues go. Each is a walk on the integrations' own cards (ConnectCard, ConnectWays, ConnectChecks).

Or the project isn't on this computer yet: Clone… beside Choose a folder finds a repository on the hosts Althar is connected to, or takes its URL, and clones it into ~/Althar; those named like the project are a press away under the folders. A clone is a row as it comes in, and a folder like any other once it's read. Then its first conversation says where it came from, and asks only where its issues go, its host's first.

- A, today's card, with git: the first-conversation card (FirstConnections) with Git, Code and Issues rows; each opens its walk in the card and comes back ticked.
- B, a walk in the conversation: one card, one question at a time, gliding from git to code to issues, then a summary.
- C, the coordinator asks: in its own words, with its answers to press; typing an answer works too.
- D, only what blocks, now: just git, at once; where the code goes is offered when the first task is done (merge here, or put it on a host first), and issues from the board's empty Up next.

Keys A–D swap the direction, 1–8 the folder (empty, files without git, git without commits, git without a remote, on a host and not here, one that can't be read, one that's a project already, later with a task done), G what's connected, R starts again from New project, T the theme. The line under the bars says what that folder does in Althar today. `?p=1&d=b&s=files&theme=dark` opens in the project.

`node lab/new-project/shoot.ts` shoots each at 1× into `lab/new-project/shots`, with the lab running (outside an agent's sandbox on a Mac).
