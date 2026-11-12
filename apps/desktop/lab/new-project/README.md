# The new-project lab

Setting up a project in a folder with no remote, in the project's own window (tabs, header, the coordinator's conversation and the board), on the kit's real pieces, with no runtime.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/new-project/vite.config.ts
```

At `http://localhost:6163`. Nothing asks where its code goes. A, drop it in: the new tab is the project already, waiting for its folder; dropped or chosen, it takes the folder's name and its mark, git is started or its first commit made where needed (said in one line), and the coordinator says what it read and plans a first task that learns how it runs. An empty folder is asked what you're making instead. B, say what you're making: name it (the tab follows as you type) and say it in the composer, the folder its chip; Start opens it with that under way. Later: tasks merge into main on this computer, and "Put it on GitHub" to the coordinator makes the repository and pushes.

Keys A–B swap the direction, 1–8 the folder (empty, files without git, git without commits, git without a remote, one that can't be read, one that's a project already, later at work, later on GitHub), R plays it again, T the theme. A folder dropped anywhere on the window works too. The line under the bars says what that folder does in Althar today. `?d=b&s=empty&theme=dark` opens on one.

`node lab/new-project/shoot.ts` shoots each at 1× into `lab/new-project/shots`, with the lab running (outside an agent's sandbox on a Mac).
