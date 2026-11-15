# The new-project lab

Setting up a project where it starts, on the kit's real screens and pieces, with no runtime: three ways in side by side (Clone, A folder, Start empty), each one's room under them the same height.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/new-project/vite.config.ts
```

At `http://localhost:6163`. Two screens:

- **A, the New project tab:** the page keeps its left side (mark, name, colour, what it's made of). Its right side is the setup: where its code comes from, where it lives (a new repository on a connected host, or only on this Mac) and where its issues go, each with a choice made already. Create does all of it in place, each part ticking as it's done, and opens the project with a line for each thing made.
- **B, the first run:** the welcome's project step takes the same three ways in. A clone's host is where its code lives, so the Code step drops out of the track; a folder or Start empty gets its own Code step, where its code lives. Then Issues, then Open.

Clone lists your repositories on GitHub, GitLab and Bitbucket, the ones named like the project first, found as you type or by a pasted URL. A host that isn't connected connects in place: from Connect beside the list, from a card when none is, or from its row under Where its code lives. GitHub and GitLab in the browser; Bitbucket Cloud with an Atlassian API token and its account's email, as Althar connects it. Its repositories then join the list. Bitbucket's own issues aren't offered: Jira is.

Errors: a clone waiting on its group's single sign-on (charrette/infra), a token that isn't an Atlassian one, a folder Althar can't read, a folder that's a project already.

Keys A–B swap the screen, 1–8 the folder Choose a folder finds (nothing chosen, empty, files without git, git without commits, git without a remote, one that can't be read, one that's a project already, later with a task done and no remote), G what's connected, R starts again, T the theme. The line under the bars says what that does in Althar today.

`node lab/new-project/shoot.ts` shoots each at 1× into `lab/new-project/shots`, with the lab running (outside an agent's sandbox on a Mac).
