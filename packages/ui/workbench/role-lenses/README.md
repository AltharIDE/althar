# Role lenses

Three directions for "Althar for the whole team" (the canvas `whole-team-flow`, and its group `role-lenses`), as stories anyone can click through: roles are lenses, not apps, so the shell is the same for everyone and a lens changes only the defaults.

- **A · Minimal.** A lens changes the landing view and how the board groups: Engineering today's board, DevOps by environment, Product and Design by feature. The lens chip in the project's row lists the handoffs waiting on you.
- **B · Panels.** Today's board for everyone, and a column of pinned panels at its end, the lens's own first; any panel can be pinned from the lens menu.
- **C · Feature-first.** The features' timeline (Intent → Spec → Design → Build → Ship → Operate) is the home, the lens's inbox of handoffs over it; the board is a press away.

Each direction has every lens's home, Saved carts' timeline with the Build → Ship handoff waiting on DevOps, and the lens switch open. Light and dark from the toolbar.

Drawn from the kit's pieces on made-up data (`features.ts`, `tasks.ts`), as `Screens/ProjectHome` draws a project. The same directions run on the whole desktop app in `apps/desktop/lab/role-lenses`. A prototype: nothing in the kit uses it.
