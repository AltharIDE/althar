# The new-project lab

Setting up a project in a folder with no remote, on the kit's own `NewProject`, `ProjectRepositories` and `ChangeSet`, with no runtime.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/new-project/vite.config.ts
```

At `http://localhost:6163`. Its name and folders come first, on the page as it is, each folder read for what it is. Then where its work goes, each question asked in the folders' place: its heading where theirs is, its choices as rows in the list they were in, Continue where Create is, Back beside it, so nothing on the page moves but the words; what is chosen joins the project on the left. The questions: where its code lives, its new repository on the host (owner, name, who sees it), where its issues go, a Linear team, then Create, its lines ticking in place as it's made. A press on a row takes it and goes on; arrows move the choice and Return takes it, so Return alone carries through. Keys A–C swap the direction (today; a step a question; ready in one press, where its work goes shown under the folders from what was chosen before, each row a press from its question), 1–8 the folder (empty, files without git, git without commits, git without a remote, one that can't be read, one that's a project already, the project at work, a remote added), G what is connected (GitHub, GitLab and Linear; GitHub only; nothing), T the theme; Escape goes back a step. The line under the bars says what that folder does in Althar today. `?d=b&s=files&c=all&card=host&theme=dark` opens on one step (`code`, `host`, `issues`, `team`, `ready`).

`node lab/new-project/shoot.ts` shoots each at 1× into `lab/new-project/shots`, with the lab running (outside an agent's sandbox on a Mac).
