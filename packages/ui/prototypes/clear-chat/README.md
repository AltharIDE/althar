# Clearing a coordinator chat, again

A prototype, to be deleted once a direction is picked. It is the real desktop app (router, project screen, board, settings, kit) on the tests' fake client, in a browser, opened on althar's conversation with its coordinator beside its board: a task at work with an errand on it, one merged, an issue draft and a plan counting down to start.

From the repository's root:

```bash
cd packages/ui && ./node_modules/.bin/vp dev --config prototypes/clear-chat/vite.config.mjs
```

Then <http://localhost:5363/>. The strip under the window switches the direction (keys 1 to 4, or `[` and `]`); Start over puts the conversation back as it was. `?d=B` opens on a direction, `bare` leaves out the strip, and `node shoot.mjs` takes every state into `.althar/scratch/clear-chat`; `node verify.mjs` checks undo, the earlier chat, a forgotten brief line, Focus and a wipe against the running page.

## What changed from the first round

The first round had three placements of one "clear" ceremony: a confirm with two kinds, a light clear with undo, a new conversation with a list. This round takes the word apart. What people want from "clear the chat" is three different things, and each direction gives one of them the control:

- **less on screen** — C's Focus;
- **a fresh start** — A's pages;
- **knowing, and correcting, what it knows** — B's brief.

The other two are still honest in each direction: open tasks, running errands and pending cards are never stopped or moved by a clear; the board doesn't change; the full wipe is always a separate, deliberate act.

| Direction | The control | The coordinator's first word | What stays | The way back | Forgetting |
| --- | --- | --- | --- | --- | --- |
| **A · Pages** | New page in the project header | "Where we left off: …", a handover, in a fresh session | open cards, and every page before | the page line: read the page before, or Undo until you write | ⋯ › Forget everything… |
| **B · What it knows** | What it knows in the header, and New chat | nothing; it answers from the brief | the brief, the open cards and the earlier chat | Earlier chat › Read; a new chat deletes nothing | the brief's Forget everything… |
| **C · Focus** | Focus in the project header | nothing; it answers from the whole conversation | the whole conversation and the session | Show all, in the header or the line | Settings › Notes › Forget everything |

**A** closes the current page into a line and opens the next with a written handover: where things stand, what is open, what it will do. The page before is one line at the top, and opens in place. The coordinator speaks first because the handover is its first message.

**B** makes the coordinator's memory a thing you can see and change. The brief is four lines — an errand, a plan, a draft, the usage — with a × on each; forgetting one changes what it says next. New chat empties the talk and starts a fresh session briefed from the brief; the earlier chat stays as one line, readable. Nothing is lost except the transcript's place on screen.

**C** is a view, not an event: Focus hides finished work and everything before the last exchange, with a line saying how much is hidden. Show all puts it back. The session never notices. Forgetting is in the project's settings, beside its notes, where it is not something done in passing.

In every direction the thread after a clear is still the same thread: the task cards keep running, the plan keeps counting down, the draft still waits for you. Talk is what a clear takes; the brief, the pages and the work are how each direction keeps the rest.

## What the runtime would need

Today one coordinator thread per project holds the conversation; its session lives as long as its agent does. After a restart, or once its context is 80% full (ADR-031), Althar starts it afresh, briefed from its records by `handoverRecord`: the project, its notes, open tasks and errands, and the last 12 messages word for word; anything older it reads with `read_thread`. There is no resuming a provider session. `thread.compact` already sends the agent its own `/compact`, so freeing the context within a session needs nothing new.

```mermaid
flowchart LR
  W[What does "clear" mean here?] --> C1[Less on screen]
  W --> C2[A fresh start]
  W --> C3[What does it know?]
  C1 --> F[C · Focus<br/>hide settled and older talk<br/>a view, no data change]
  C2 --> P[A · Pages<br/>a handover, a fresh session<br/>the page before kept]
  C3 --> B[B · What it knows<br/>the brief is the memory<br/>a fresh session from it]
  P --> D1[Forget everything<br/>sessions end, items go]
  B --> D1
  F --> D2[Settings › Forget everything<br/>sessions end, items go]
```

What each asks for:

- **A · Pages.** Several pages in a project's conversation: either page marks over one thread, or several coordinator conversations with one current. A handover turn at each page start (a summary the live model writes, or one Althar writes from its records without a model), stored as the page's first item and used as the fresh session's brief in place of the last 12 messages. `read_thread` reads earlier pages, so "read the page before" has a path. Undo holds the page boundary and the new session until the first message on it. Forget ends every session, drops what waits in the queue, and deletes the items, so neither `read_thread` nor a brief can reach them; notes, tasks and errands stay. The cost is one summary turn per page.
- **B · What it knows.** The brief is the new piece: persisted per project, shown, edited, and injected into every session. Today's handover record is composed at session start and thrown away; this one is kept and becomes the coordinator's memory. The coordinator maintains it — a tool that adds, changes or drops a line, or a diff at the end of a turn — and the person can correct it. New chat starts a session briefed from the brief, so the context is freed and the brief is the only thing carried; the chat is a range of the thread, readable later. Forget deletes the brief and the thread's items and ends the session. This is the most runtime work, and the only one that makes "keep what it knows" inspectable and correctable.
- **C · Focus.** A view preference per project, kept somewhere in its settings; no runtime change, and no session to end until Forget. The line's counts come from the items the view hides. Forgetting is the same as A's, and the context can be compacted with the existing `/compact`.

## Recommendation

**B, with C's Focus as the everyday lens.** B removes the question the old directions kept asking — "what will it still know?" — by making the answer a short, editable list. Clearing the talk then costs nothing and the coordinator's memory is inspectable, which is worth the one new runtime piece. C is the cheapest and quietest and can sit on top of any of them as the default view; on its own it never gives a fresh session. A is for when a hard boundary is wanted — a new session, a fresh context — and one summary turn per page is acceptable; it is the best version of the old "new conversation", with the page in the thread rather than a list.

## What the prototype leaves out

The fake client has no runtime behind it: the handover and the brief's answer are written into the page, not by a model. Pages beyond the last are read all at once, and the brief is not yet maintained by the coordinator — both are described above as work the real thing needs. The earlier-chat line reads the last one; a real history would list them all. The narrow header keeps glyphs with the labels in tooltips, which is the kit's own compact button.
