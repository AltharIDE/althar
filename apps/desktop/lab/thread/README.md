# The thread lab

The app's own task and coordinator threads (`TaskThread`, `ThreadBlocks`, through `roundsOf` and `blocksOf`), drawn from a long, messy task thread made up for them (`thread.ts`), with an agent's turn played as the runtime streams it (`play.ts`): whole copies at most every 50 ms, at a model's pace, with the stalls a provider's stream has. No runtime, no Electron. It is for feeling how a thread streams and folds, and for timing its frames.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/thread/vite.config.ts
```

At `http://localhost:6131`. Keys 1–4, or the bar along the bottom, swap the scene: the long task once it's over, the task with its lead at work (thinking, saying what it will do, its steps one line at a time, its report, then its handoff as the work folds), the coordinator answering, and three coordinator threads streaming a long answer at once. `?theme=dark` draws it dark.

`shoot.ts` shoots it headless at 1×, into `lab/thread/shots` (git ignores it, and the end-to-end run, which empties `test-results`, leaves it), with the lab running (Chromium can't start in an agent's sandbox on a Mac; run it outside):

```bash
node lab/thread/shoot.ts shots after task light 1000 900   # the opening view and the whole thread
node lab/thread/shoot.ts frames live live 16 700           # a frame every 700 ms of the live task
node lab/thread/shoot.ts moments live light                # the live task's round at each moment of its turn, waited for
node lab/thread/shoot.ts moments coordinator dark coordinator  # the coordinator's turn, the same
node lab/thread/shoot.ts timing three 25                   # each frame's time, and the main thread's, while three stream
```

Time frames on a build, as the app runs, not the dev server (React's development build and StrictMode double its work): `vp build --config lab/thread/vite.config.ts`, then `vp preview` with the same config, and `LAB_PORT=6132` before `node lab/thread/shoot.ts timing`.
