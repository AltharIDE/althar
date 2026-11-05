# A task thread that leads with the handoff

A prototype, to be deleted once a take is picked. It is the real desktop app (router, board, task screen, kit) on the tests' fake client, in a browser, with two tasks of this repository's: a long investigation with three review rounds, a question from the person on the way, "Started Codex afresh" notices, a blocking finding left to the person and a push that rewrites history; and a short clean change whose one review passed.

Every take keeps the chat and is drawn from the kit's own thread pieces: anything that is work, a review included, is the thread's one faint line (`WorkLine`) that opens in place; the lead's words are its `Round`; what needs the person is a short quiet list with the answers on it. The takes differ in where the lead's handoff stands. Seams in `vite.config.mjs` swap the thread for each take, and leave out the permission card at the thread's end, which each take draws with what else needs the person.

From the repository's root:

```bash
cd packages/ui && ./node_modules/.bin/vp dev --config prototypes/handoff/vite.config.mjs
```

Then <http://localhost:5361/>. The strip under the window switches the take (keys 1 to 6, or `[` and `]`) and the task.

| Take | What it is |
| --- | --- |
| A · Calmer | The thread as it is, each part quieter: the lead's turns say what came of them in a line, each review is one faint line, Althar's restarts on its hover. The lead's latest turn says what the task has built; what needs you ends the thread. |
| B · Last word | All the work is faint lines: each step of the lead's, each review with the lead's answer inside it. Your messages and the lead's replies stay words. The lead's handoff is the last message, what needs you its closing lines. |
| C · One answer | One answer to each thing you said: its reply or what it set out to do, all its work and reviews in one line, then what came of it. The latest answer's words are what the task has built. |
| D · Replies | The lead's report is one message that stays current, with the reviews hanging under it as replies. What needs you waits over the composer, in view however far you scroll. |
| E · Answer first | Opens at the start: your ask, where it stands under it, what needs you; how it got here below, as A draws it. |
| Today | The thread as built, on the same tasks. |

For screenshots, the URL takes `d` (A to E, Today), `bare` (no strip), `open=r2` (Review 2 opened), `scroll=top` or `scroll=end` (the thread at its start or its end), and the task after the `#`: `#/threads/th-long` or `#/threads/th-short`.
