# The computer use lab

The task's computer use card as the desktop app draws it, under a lead at work in a task's thread, in each state a session goes through: the app's own `ComputerUse` feature and the kit's card, on a made-up session with no runtime or native helper behind it (`main.tsx`). Answering and the card's buttons play on: an answer or a press is taken a moment later, as the native helper would, and the Refused state refuses them.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/computer-use/vite.config.ts
```

At `http://localhost:6135`. The bar along the bottom, or keys `1`–`8`, swap the state in place: Asks, No display (Linux with several displays), Long reason, At work, Observed, Taken over, Stopped, Refused. The address opens one for a screenshot: `?scene=observed&theme=dark`.

## Shots

With the lab running, `shoot.ts` takes each state light and dark, at 1×, headless: the thread's end and the card alone, into `shots/` (which git leaves alone).

```bash
cd apps/desktop && node lab/computer-use/shoot.ts after
cd apps/desktop && node lab/computer-use/shoot.ts after ask,observed 900 760
```
