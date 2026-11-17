# The issue part lab

How a task says whether its merge closes the issue it came from (it does all of it) or leaves it open with a comment on what landed (it does part). Today that is a switch under the issue's card, "Keep DEV-211 open", with a note under it (PR #1004). The person found it unclear. Four other ways, on the whole desktop app in the browser: its router and real task screen, on made-up data with no runtime (`data.ts`: althar, one task from Linear's DEV-211, and its thread). One import seam in `vite.config.ts` gives `TaskView.tsx` the lab's kit (`ui.ts`), where the issue's card, the switch under it and the header's Parts are each direction's (`Directions.tsx`). Everything else is the app's own.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/issue-part/vite.config.ts
```

At `http://localhost:6179`. The bar along the bottom, or its keys, swaps in place:

- `0` today's and `A`–`D` the four.
- Where the task stands: `1` its pull request still to come, `2` #1012 open, `3` a task that ends with no pull request (a prototype, a chat). With `3`, nothing shows in any direction: there's no merge to speak of.
- `T` a second issue, from GitHub with a long title: the crowded case (a task can come from several issues, PR #1006).
- `N` the app's narrowest window.

The address keeps it all, and opens a state for a screenshot: `?d=b&ending=open&two=1&part=%23842` (`part` lists the issues done only in part).

## The directions

None has a line explaining it. Each says what the merge does to the issue in the words a pull request uses ("Closes", "Part of"), or in a plain sentence.

- **A · Two words.** The card grows a foot, in the same frame: `Closes it | Part of it`, the kit's segmented control. Both ways are in sight, the one on lifted; one press switches.
- **B · Corner tag.** One word on the card's top line, before the way out to the tracker: `✓ Closes ⌄` or `◐ Part of ⌄`, with the tracker's own glyphs for done and in progress. A press opens the two, each with what becomes of the issue. It's the smallest, and it adds no row.
- **C · Sentence.** A line under the card that reads as one: "Merging #1012 **closes it** ⌄" or "… **leaves it open** ⌄", its verb the choice ("Merging" alone before there's a pull request).
- **D · In Parts.** Nothing under the card. The issue's part, in the header's Parts, has "On merge: Closes it | Part of it" among its title and status. The thread stays clean, but you only see the choice when you open Parts.

## Screenshots

`shoot.mjs` shoots each direction, its menus and the crowded case, the window at 1×, into `lab/issue-part/shots`, with the thread's head alone in `shots/close` (git ignores both), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside:

```bash
node lab/issue-part/shoot.mjs
```

Delete the lab once a direction is picked to build, before building it.
