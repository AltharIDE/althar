# Prototype: a sign of life between send and the first word

Throwaway. One live page: the real desktop app (its router, the coordinator's conversation, a task's thread, the kit's Turn, Round, You, WorkLine, Thinking, LiveDot, Logo) on the tests' fake client. A fake runtime replays what the real one does after Enter, in the same order: the window's own copy of the message, the store's copy (queued), delivered to the agent with the turn running, then the first streamed words, or the agent's error.

From `apps/desktop` (inside the agent sandbox it works too, with polling):

```bash
bunx vp dev --config prototypes/sign-of-life/vite.config.mjs
```

Then open **http://localhost:5397/**. The bar at the bottom:

- **Direction**: Today, A · Dots, B · Receipt, C · Placeholder, D · Althar's mark, E · Name at once (keys 1–6, ← and →), swapped in place.
- **Screen**: Coordinator or Task.
- **First word after**: 1s, 5s, 20s, or Fails (nothing for 45 seconds, then the agent gives up with a 529).
- **Lead busy**: the lead is at work when you send, so the message waits its turn in the composer's queue; it finishes 5 seconds later and turns to yours.
- **Reduce motion**: what a Mac set to reduce motion sees (the kit's own motion too).
- **Send** (or `s`): the thread as it was, then the message, typed into the real composer and sent with Enter. You can also type in the composer yourself.

The strip over the bar is the direction's timeline: the clock since Enter, and when each thing appears. Click a beat to hold the page there, and **Run on** to let it go. The address keeps all of it: `?d=E&v=task&delay=20&busy=1&reduced=1`. `&at=8` sends as the page opens and holds 8 seconds in; `&send=1` sends and lets it run (for the queue). These are for pictures.

`node shoot.mjs` shoots every shot in `shots.json` at 1×, and `sh sheets.sh` groups them onto sheets in `shots/` (outside the sandbox: Chromium can't start in it).

## What Althar shows today

After Enter, in both the coordinator's chat and a task's thread:

1. **0s**: your message lands at once (the window's own copy, `shared/items.ts` `sending()`), with "just now" under it. The composer's Send becomes Stop, and its placeholder "Add to the queue, or interrupt…". In a task, the header says **Working**.
2. **~0.1s**: the store's copy arrives *queued* (`Sessions.ts:1994`). With the agent idle, the queue isn't shown, so the bubble can flash "Queued · the lead reads it next" for a moment, until…
3. **~0.3s**: …it is delivered and the turn runs (`turnRunning`).
4. **Then nothing new under your message until the first chunk.** `Thinking` (`Reasoning.tsx`) is never used in the app. The thread's `aria-busy` is set, but nothing shows it.
5. **What does move is wrong**: the *previous* reply comes back to life. `thread.ts:477` takes the last turn as the running one, so the coordinator's previous answer gets a spinner and "Working for 14m 3s", timed from that old turn, and loses Copy. In a task, `rounds.ts:197/215` re-opens the previous round: its final answer folds into a live "Working · 51m" line. (shots: `sheet-today.png`)
6. **First chunk**: the name and the words arrive together (a message), or a live work line (a thought, or a tool call, which comes as a change rather than a stream).
7. **Failure**: when the prompt fails, an error notice says "Claude Code couldn't answer." and the agent's message: open in the coordinator, a warning line in a task. **No timeout**: the stall watcher acts after 10 minutes without a sign of life.
8. **Queued** (sent while the lead works): the message waits over the composer ("Queued; the lead reads it next", Edit, ×), not in the thread. When the turn ends it's delivered, and the gap starts then, with nothing in it again.

In every direction the page fixes 2 and 5 (only a turn after your last message runs; your message reads as sent), so each is judged on its own.

## The directions, and when each thing appears

Seconds from Enter. "First word" is whenever it comes (the picker). Every direction shows nothing before 0.4s, so a quick answer never flashes a mark. The seconds join at 3s, and "longer than usual · Stop" at 30s. On failure: **No answer**, why in a line, and **Send again**.

| | 0s | 0.12s | 0.35s | 0.4s | 3s | 30s | first word | fails (45s) |
|---|---|---|---|---|---|---|---|---|
| **Today** | message, Stop | | | | | | name and words together | error notice |
| **A · Dots** | message | | | three cobalt dots where the reply starts, lit in turn | `··· 3s` | `··· 34s · longer than usual · Stop` | the name takes the dots' line, words under it | dots go grey: No answer · why · Send again |
| **B · Receipt** | under your message: Sending | Sent | ● Claude Opus has it | | ● Thinking · 3s | … · longer than usual · Stop | the receipt settles to "just now"; the reply below | under your message: No answer · why · Send again |
| **C · Placeholder** | message | | | the reply's name, and "Thinking" shimmering as its first line | Thinking 3s | … · longer than usual · Stop | the words replace the line in place | the line says No answer · why · Send again |
| **D · Althar's mark** | message | | | Althar's mark draws itself (1s), fills, then its cobalt point breathes | mark 3s | … · longer than usual · Stop | the mark gives way to the name | the mark stills: No answer · why · Send again |
| **E · Name at once** | message | | | the reply's name, with a breathing cobalt dot where its time goes | Claude Opus ● 3s | under the name: longer than usual · Stop | the dot goes, words under the name, which never moves | under the name: No answer · why · Send again |

**Queued**, in every direction: nothing in the thread while it waits over the composer. The sign of life starts when the lead turns to it, and its clock counts from then, not from Enter.

**Reduced motion**: A's dots stand in three still steps of cobalt. C's Thinking is plain grey. D's mark is drawn whole, its point steady. E's dot is steady. The seconds still count.

**Hand-off**: A, C and E keep the reply's name in the place the sign stood (E and C draw the kit's own Turn or Round header, so it's the same pixels). D's mark is within a few pixels. B's reply arrives below, as today, with the receipt as the sign.

## Pick: E, name at once

- **Nothing moves, whatever comes first.** The reply's header is there from 0.4s, and words, a thought's work line or a tool call all grow under it. A swaps a mark for the name, and C's placeholder line is right only when words come first; with a thought first, a work line has to take its place.
- **It says who.** Althar's threads have several voices (the coordinator, a lead, a reviewer). "Claude Opus ●" says whose turn it is, where B's "Thinking" under your message doesn't, and the dots don't.
- **No new primitive.** It is the kit's Turn/Round header with the LiveDot that already means "running" in cobalt. That fits "few primitives".
- **The queue stays honest.** A message waiting its turn has no header, because no one has turned to it yet.

To take from the others: B's honest steps (Sent, has it) belong where something goes wrong, e.g. "Not delivered: Claude Code isn't running" under the message. A's seconds-after-3s rule is in E already. E's dot is quiet. If people miss it, the next step up is A's dots in the same place, after the name.

## What the real build needs

- **The renderer can't tell "the agent has it" from "first token" today.** The runtime can: it keeps `turn_delivery.requested`, then `delivered` (with `deliveredAt`), then `TurnStarted` once ACP's `session/prompt` is sent, then the first `agent_thought_chunk`, `agent_message_chunk` or `tool_call`.
  - The renderer gets none of it except `turnRunning`, by re-reading the head, and `Streaming` (which tells a thought from a message). `TurnStarted` is dropped (runtime `Api.ts:367-391`), and no turn-start time reaches it.
  - **Needed:** the session's turn start (`deliveredAt`) on `SessionSummary` (or on the user message's input), so the seconds count from the runtime's clock and survive a reload.
- **ACP has no acknowledgement.** The prompt's response is the end of the turn, so "read" can't be known. "Has it" means handed to the agent, which is as far as anyone can honestly say. A first token is the first update of any kind.
- **The live-turn bug**: `thread.ts:477` and `rounds.ts:197/215` should take only a turn after the last delivered user message as live. The fix is `fix.ts` here.
  - Then a pending turn is a block of its own: `blocksOf` and `roundsOf` emit a live, empty turn when `turnRunning` and nothing follows your message, and Turn/Round take a `waiting` state (the dot and the seconds where `at` goes).
- **The "Queued" flash**: keep the window's copy as sent until the store's copy is delivered, or don't show the store's copy as queued while the agent is idle.
- **Failure**: the error notice exists; it needs **Send again** (the same body, `client.send`). The 30s "longer than usual · Stop" is the client's own clock; the runtime needs nothing for it. The stall watcher's 10 minutes stays as it is.
- **Accessibility**: one `role="status"` with a steady label ("Claude Opus is thinking"); the seconds `aria-hidden`, so a screen reader isn't told every second.

## How it's built

- `vite.config.mjs`: seams swap ProjectView's `ThreadBlocks`, TaskView's `TaskThread` and ThreadBlocks' kit (for B's `You`). Since C was built into the app, patches to `thread.ts` and the kit's `You.module.css` keep it out of the comparison: Today is the app as it was before (`fix.ts`), and every direction drops the app's own Thinking (`seams/adjust.ts`).
- `store.ts`: the page's state and the fake runtime's timeline (stored, handed, first word, streaming, the lead's work, failure, queue).
- `life/`: the directions. `seams/adjust.ts`: the blocks as each direction has them.
- `timeline.ts`: the beats the strip shows. `data.ts`: the two conversations and the replies.
