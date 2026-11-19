# The Connect a home lab

The Connect a home dialog's chosen direction, A (the drawing), beside the dialog as built, each made of the kit's components and the app's own connection form (`useConnect`), on a home host that answers after a believable while. No runtime, no Electron.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/connect-home/vite.config.ts
```

At `http://localhost:6141`. The bar along the bottom, or its keys, swaps in place:

- **0** the dialog as built; **A** the drawing
- **P** / **S** pairing code or SSH; **I** a first home: its intro, then setting the home up (over SSH, where Althar installs it, or one command on the server that prints a pairing code)
- **F** fails the host's next answer; **R** starts over

The fake host takes about a second to check a host and to connect. Any host works; any pairing code reads.

`shoot.ts` shoots each direction's scenes headless at 1× (`?s=` drives the dialog to each), and a sheet of them, into `lab/connect-home/shots` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside:

```bash
node lab/connect-home/shoot.ts dir a       # THEME=dark for dark
```

The setup is assumed: there is no installer (`curl … | sh`) and no install over SSH yet; today a home is built from source and needs its own TLS certificate (`apps/host/README.md`).
