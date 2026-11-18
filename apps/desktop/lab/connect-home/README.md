# The Connect a home lab

Directions for the Connect a home dialog, each made of the kit's components and the app's own connection form (`useConnect`), on a home host that answers after a believable while. No runtime, no Electron.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/connect-home/vite.config.ts
```

At `http://localhost:6141`. The bar along the bottom, or its keys, swaps in place:

- **0** the dialog as built; **A** the drawing; **B** the setup; **C** the host side
- **P** / **S** pairing code or SSH; **I** a first home, with its intro
- **F** fails the host's next answer; **R** starts over

The fake host takes about a second to check a host and to connect. Any host works; any pairing code reads.

`shoot.ts` shoots each direction's scenes headless at 1× (`?s=` drives the dialog to each), and a sheet of them, into `lab/connect-home/shots` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside:

```bash
node lab/connect-home/shoot.ts dir a b c       # THEME=dark for dark
```
