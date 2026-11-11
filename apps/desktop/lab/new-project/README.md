# The new-project lab

Setting up a project in a folder with no remote, on the kit's own `NewProject`, `ProjectRepositories` and `ChangeSet`, with no runtime.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/new-project/vite.config.ts
```

At `http://localhost:6163`. A new project is two steps: its name and folders, each read for what it is, then where its work goes, its code and its issues. Keys A–C swap the direction (today; two steps laid out as choices; two steps as the settings' own rows), 1–8 the folder (empty, files without git, git without commits, git without a remote, one that can't be read, one that's a project already, the project at work, a remote added), G what is connected (GitHub, GitLab and Linear; GitHub only; nothing), T the theme; Step 1 and Step 2 in the bar, or Continue and Back on the page, walk the steps. The line under the bars says what that folder does in Althar today. `?d=b&s=local&step=2&c=all&code=gitlab&theme=dark` opens on one.

`node lab/new-project/shoot.ts` shoots each at 1× into `lab/new-project/shots`, with the lab running (outside an agent's sandbox on a Mac).
