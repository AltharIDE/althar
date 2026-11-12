# The new-project lab

Setting up a project on the New project page itself, on the kit's real screens and pieces, with no runtime.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/new-project/vite.config.ts
```

At `http://localhost:6163`. The page keeps its left side (mark, name, colour, what it's made of). Its right side is the setup:

- **Code:** clone a repository from GitHub or GitLab (your repositories, the ones named like the project first and lit in its colour, found as you type or by a pasted URL), or a folder on this Mac, or start empty. A folder says what git is in it and what Create does about it.
- **Where its code lives:** a new repository on a connected host (owner, name, private or public), or only on this Mac. A clone lives where it came from.
- **Issues:** the host's own issues (first for a clone with open ones), Linear (a new team or one you have), or none for now.

Each has a choice made already. Create does all of it in place: each part ticks as it's done, the foot says what's under way, and the project opens with a line for each thing made. Errors: a clone waiting on its group's single sign-on, a folder Althar can't read, a folder that's a project already.

- A, your repositories first: the side opens on your repositories; choosing one (or a folder, or Start empty) turns it into the three parts.
- B, three ways in: Clone, A folder and Start empty side by side, each one's room under them the same height, the other parts always below.
- C, one sheet: a row each, every one chosen already (the repository named like the project, a new one on GitHub, Linear); Create at once if they're right.

Keys A–C swap the direction, 1–8 the folder Choose a folder finds (nothing chosen, empty, files without git, git without commits, git without a remote, one that can't be read, one that's a project already, later with a task done and no remote), G what's connected, R starts again, T the theme. The line under the bars says what that folder does in Althar today.

`node lab/new-project/shoot.ts` shoots each at 1× into `lab/new-project/shots`, with the lab running (outside an agent's sandbox on a Mac).
