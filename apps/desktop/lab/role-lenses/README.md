# The role lenses lab

Three directions for "Althar for the whole team" (the canvas `whole-team-flow`), drawn on the whole desktop app in the browser: its router, tabs and real screens, on made-up data with no runtime (`data.ts`: a team's project, storefront, with work of every role on its board; `features.ts`: its features, their stages, the handoffs waiting and what each role's panels would read). Roles are lenses, not apps: the same shell for everyone, and a lens changes only the defaults.

One import seam in `vite.config.ts` gives `ProjectView.tsx` the lab's project row (`ui.ts` → `Switcher.tsx`: the lens chip before ⋯) and the lab's board pane (`Lens.tsx`, in place of `BoardView`, which it draws inside where a direction keeps today's board). Nothing in the app changes.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/role-lenses/vite.config.ts
```

At `http://localhost:6181`. The bar along the bottom, or its keys: `A` `B` `C` the direction, `1`–`4` the lens (Product, Design, Engineering, DevOps), `F` Saved carts' timeline, `L` the lens menu. The address keeps it all: `?d=b&role=devops&feature=saved-carts&theme=dark`.

- **A · Minimal.** The same layout for everyone. A lens changes the landing view and how the board groups: Engineering today's board, DevOps by environment, Product and Design by feature. The lens chip's menu lists the handoffs waiting on you.
- **B · Panels.** Today's board for everyone, and a column of pinned panels at its end, the lens's own first: DevOps cluster health, alerts and deploys; Engineering CI and pull requests; Design canvases, Storybook and screenshot diffs; Product features by stage and the Linear cycle. Any panel can be pinned from the lens menu.
- **C · Feature-first.** The features' timeline (Intent → Spec → Design → Build → Ship → Operate) is everyone's home, the lens's inbox of handoffs over it, its own stages marked. Its heading switches whose inbox; the board is a press away (Features | Tasks).

A feature's timeline opens in the board's place in every direction: its stages, what each put in the repository and who passed its gate, and the handoff waiting, with what the coordinator proposes to start.

`shoot.mjs` shoots each direction's four states (Engineering's home, DevOps's home, the timeline, the lens switch), light and dark, into `shots/`. Run it outside an agent's sandbox, where it can reach the lab's server.
