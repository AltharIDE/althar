# A task thread that leads with the handoff

A prototype, to be deleted once a direction is picked. It is the real desktop app (router, board, task screen, kit) on the tests' fake client, in a browser, with two tasks of this repository's: a long investigation with three review rounds, a question from the person on the way, "Started Codex afresh" notices, a blocking finding left to the person and a push that rewrites history; and a short clean change whose one review passed.

Seams in `vite.config.mjs` swap a few of the task screen's imports for these pages alone: the thread (each direction's), the face it opens on, Outputs' left column (for B) and the permission calls at the thread's end (A and C draw them with the handoff).

From the repository's root:

```bash
cd packages/ui && ./node_modules/.bin/vp dev --config prototypes/handoff/vite.config.mjs
```

Then <http://localhost:5361/>. The strip under the window switches the direction (keys 1 to 4, or `[` and `]`) and the task.

| Direction | What it is |
| --- | --- |
| A · Thread, tidied | In order: the lead's turns in two lines, each review one card with the settle that answers it; then what needs you and where it stands, pinned last, and the thread opened on them. |
| B · Where it stands | Outputs becomes the face every task opens on: what needs you, what it built, every finding once, how it got here; the pull request beside it. The tidied conversation is behind it. |
| C · One ask, one answer | Reviews are the lead's work, not turns of the conversation: each ask gets one answer, its rounds a rail whose stops open in place, its words what the task has built. |
| Today | The thread as built, on the same tasks. |

For screenshots, the URL takes `d` (A, B, C, Today), `bare` (no strip), `open=r2` (Review 2 opened), `scroll=top` (the thread at its start) and `face=talk` (B's conversation), and the task after the `#`: `#/threads/th-long` or `#/threads/th-short`.
