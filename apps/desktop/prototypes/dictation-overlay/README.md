# Prototype: dictation that follows you across screens

Throwaway. You dictate to the coordinator and, mid-sentence, open a task to look at what you are talking about. Today the composer goes with the screen, and so does what you said. Here the dictation carries on in an overlay, still addressed to where you started, and you send it there or to the task you are looking at.

It runs on the real desktop app in a browser: its router, tabs, home, board, coordinator conversation and task screen, and the kit's composer, on the tests' fake client. A fake stream says a script a word at a time, with a word heard wrong and then put right. The dictation is kept by thread (`coordinator:p1`, `thread:<id>`), as "Keep composer text and dictation when navigating away" keeps it. Import seams in `vite.config.mjs` swap the screens' `useDictation` for the fake one, let the composer say when it is on screen, and let D draw on the project's tab. No product code changes.

From `apps/desktop`, outside the agent sandbox, where Vite misses edits:

```bash
bunx vp dev --config ./prototypes/dictation-overlay/vite.config.mjs
```

Then open http://localhost:5397/.

- The bar at the bottom switches the idea in place (Today, A to E) and the state (listening, a long one, writing down with a busy Mac, written and waiting to send, couldn't write it down, moved on again). Start over restarts the state. Home, Board, Coordinator and the two tasks go there; the app's own tabs, cards and back buttons work too.
- Keys: 1 to 6 for the idea, ← and → for the idea before or after, ⇧← and ⇧→ for the state. ⌘⇧D stops the dictation, as in the app.
- The address keeps the idea, the state and where the window is: `?idea=B&state=long&at=/threads/th-scroll`. Add `&still` to hold the stream for a screenshot, `&open` to open the card, the sheet or the peek.

## The ideas

| | What it is | Where the words show | Out of the way by | Whose message |
| --- | --- | --- | --- | --- |
| Today | What main does | Nowhere once you leave the conversation; on the board it keeps listening with nothing on screen | n/a | Gone |
| A · Pill | A pill that opens into a card | Floating just above the screen's own composer, or the bottom edge where there is none; drag it anywhere | Being small until opened; it opens itself once written | "To the coordinator · althar"; Send's menu offers this task's lead instead |
| B · Call bar | A bar along the bottom of the window, as a call has | The latest words run along it; click for the whole of it | Taking its own room: it covers nothing until opened | The same, on the bar |
| C · Mini composer | The kit's composer, small, in the corner | In its field, as the conversation's composer shows them | Sitting above the screen's own composer, at the side | "To: Coordinator ▾" in its lower row; choosing this task moves the words into the task's own composer |
| D · On its tab | Your voice and the time on the project's tab | In a peek from the tab | Living in the tab bar; the tab turns violet once written | In the peek, with the same Send |
| E · Goes where you look | The words move into the composer on screen | That composer, with a line over it; a pill where a screen has none | Using the composer that is there | The screen's: "Moved here from the coordinator · Send it to the coordinator instead" |

Every overlay has pause, stop (writing it down), throw away (with Undo), back to its composer, Send (still talking, it is written down first and then goes), and the text to change once written. Back at the composer it goes to, the overlay goes and the words are in that composer, live, or in its field once written.

## Screenshots

`node prototypes/dictation-overlay/shoot.mjs [id…]` (outside the sandbox, with the server up) takes these into `shots/`, which git ignores. Captions are in `shots.json`.

- T1 Today, on the task you opened mid-sentence: nothing says you were talking.
- A1 A, listening, on the task: a pill just above the task's own composer, still to the coordinator, with the last words.
- A2 A, a long one, opened into its card.
- A3 A, written, on the board: the card opens by itself with the text to change.
- A4 A, written, on a task: Send's menu offers this task's lead instead.
- B1 B, listening, on the home.
- B2 B, a long one, opened over the task.
- B3 B, writing it down while the Mac is busy (the CPU meter is full): it says it takes longer.
- B4 B, couldn't write it down: kept, with Try again.
- C1 C, listening, on the task, above the task's own composer.
- C2 C, written, with who it goes to in its lower row.
- C3 C, couldn't write it down: the composer's own tray.
- D1 D, listening: only the project's tab says so.
- D2 D, the words open from the tab.
- D3 D, written: the tab turns violet and says To send.
- E1 E, the words moved into the task's composer, with a way to send them to the coordinator instead.
- E2 E, then on the board, which has no composer: a pill, going to the task looked at last.
- M1 Moved on again (A): two tasks later, still to the coordinator, and it says what you looked at.
- M2 Back at the conversation: the overlay goes, and the words are in its composer, live.
- P1–P8 A among the composer's other pills (Running, Listening), at 1× and cropped to the composer's end: see below.

## A among the pills

A composer already has a row of pills over it, at its left: Running (what the lead left running, or what Althar runs of the project) and Listening (the pull requests a task listens to, which says for a moment what one just heard). The row wraps upward when they don't fit. "What else runs" in the bar fills them from the fake data the screens read: nothing, a server and a pull request, or crowded (three processes and one that exited, two pull requests, and a reviewer's comment a moment after the task opens). With A on, a second switch says where its pill goes among them; it is in the address as `&place=` and `&crowd=`.

- **Centre**, as first drawn: centred over the composer, it sits on the pills once there are any (P1).
- **Right end**: at the composer's right, on the pills' line; where they leave no room it moves up a row (P2).
- **In their row**: one more pill in the composer's own row, first and nearest the field, as tall as the others, with "To the coordinator" only (the project's mark says where) and the last few words; the others move along and wrap above it, as the row already does (P3, P5). Running's list opens above it, untouched (P6).
- **Above them**: the full pill, centred over the whole stack (P4).

In all but Centre, the card (opened, or written and waiting) opens above the whole stack, so the pills stay in sight (P7); a pill's list opened then goes over the card (P8).

What it showed: at this width, Running and Listening already take a row each, so with the dictation it is three rows.

**Picked: Above them (P4).** The dictation stays the full pill with more of its words, centred over the whole stack and never mixed into the pills' row. It is now the default for A; the page opens on it, and the other places stay in the switch.

## Which I'd pick

A, the pill. It keeps the words near where you were looking when you started, just above whatever composer the screen has, so it rarely covers what you opened to look at. It always says who the message is for, and it only gets bigger when you open it or once the text is written. B is the runner-up if the overlay must never cover anything. C feels the most like the app, but two composers on a task screen make it unclear which one you're talking into. D is too hidden while you're talking, though its tab mark would be a good second signal for A when the pill is small. E sends to whatever you look at by default, which is wrong in the very case that started this: you look at a task to talk to the coordinator about it.

## Open, for the real change

- The running task "Keep composer text and dictation when navigating away" stops listening when you leave the screen, because an open microphone with nothing on screen listens where nobody can see. These ideas keep listening, with the overlay as what you see. The two need to agree.
- Away from its composer, ⌘⇧D belongs to the overlay.
- Today, Escape while listening throws the dictation away. With an overlay, Escape should do what it does on the screen (back from a task), and throwing away is the overlay's own button, with Undo.
- The brief asked for a red dot on the tab. The kit says "dictating is you talking, not a warning", and draws your voice as ink bars, so D uses its live blue, and the violet of what waits on you once the text is written.
