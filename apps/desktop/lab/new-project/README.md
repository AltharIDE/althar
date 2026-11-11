# The new-project lab

Setting up a project in a folder with no remote, on the kit's own `NewProject`, `ProjectRepositories` and `ChangeSet`, with no runtime.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/new-project/vite.config.ts
```

At `http://localhost:6163`. Keys A–D swap the direction (today, quietly with the remote later, asking with the remote now or not, starting from a description), 1–8 the folder (empty, files without git, git without commits, git without a remote, one that can't be read, one that's a project already, the project at work, a remote added), T the theme. The line under the bars says what that folder does in Althar today. `?d=b&s=files&theme=dark` opens on one.

`node lab/new-project/shoot.ts` shoots each at 1× into `lab/new-project/shots`, with the lab running (outside an agent's sandbox on a Mac).
