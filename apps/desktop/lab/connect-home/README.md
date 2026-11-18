# The Connect a home lab

The app's own Connect a home dialog (`ConnectHome`, with `PairHome`'s pairing step), on a home host that answers as each scene needs, driven to that scene as a person would type and press. No runtime, no Electron. It is the dialog's story: every state of it, light and dark, in one place.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/connect-home/vite.config.ts
```

At `http://localhost:6141`. `?scene=` picks the state: `ssh`, `ssh-options`, `ssh-checking`, `ssh-refused`, `ssh-checked`, `ssh-connecting`, `ssh-failed`, `pair`, `pair-checked`, `pair-refused`, `pair-pairing`; `?theme=dark` draws it dark.

`shoot.ts` shoots each scene's dialog headless at 1×, light and dark, with a sheet of them all, into `lab/connect-home/shots` (git ignores it), with the lab running (Chromium can't start in an agent's sandbox on a Mac; run it outside):

```bash
node lab/connect-home/shoot.ts after              # every scene
node lab/connect-home/shoot.ts after ssh-checked  # one
```
