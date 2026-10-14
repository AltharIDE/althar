# Prototype: allow everything, for a project and a task

Throwaway. One page: the real desktop app (its router, tabs, Rules, task and board screens) on the tests' fake client, with a slim bar at the bottom that switches between today and five paths in place, on the same screen and with the same state.

From `apps/desktop`, outside the agent sandbox (inside it Vite doesn't see edits):

```bash
bunx vp dev --config ./prototypes/allow-everything/vite.config.mjs
```

Then open http://localhost:5361/. The address keeps what shows: `?d=T|A|B|C|D|BC&v=task|rules|board&s=fresh|task|project|ended`, plus `&o=menu|chip|pill|compare` to open one thing as the page starts. Keys 1–6 and ←/→ switch the path; the bar also switches the screen and the state, and Compare opens the table.

How it's made: `vite.config.mjs` swaps a few imports of the real screens (TaskHeader, Composer, BoardCard, the task's permission calls) for wrappers in `seams/`, and patches a slot into three kit components as they're served (the permission card, the task menu, the rules screen). Nothing in the app or the kit changes on disk; with Today the slots are empty. The fake runtime (`data.ts`, `store.ts`) holds meridian's rules and one task whose lead asked seven things in a row.

With the server up, `node prototypes/allow-everything/shoot.mjs [id…]` retakes the shots in `shots.json` into `shots/` (git ignores it, with a captioned list in `shots/README.md`).

## The paths

- **Today**: the mode is one underlined word in the rules' last sentence. A card for a kind meridian always asks about offers Never but no "always allow", and says nothing of why.
- **A · One switch**: a switch over the rules (the lists it turns off quieten), the same switch in the task's menu, "Unrestricted" beside the menu and on the board card.
- **B · Modes, task chip**: the four modes as a segmented control on Rules; a chip in the task's header ("Project default · Allow, except what you keep") that opens to override for this task, with Back to project default.
- **C · From the prompt**: the card gets "Yes, and stop asking on this task"; the queue clears into one line with Ask again.
- **D · For a while**: allow everything for 1 hour, until the task is ready, or until turned off; a pill over the composer with the time left; when it ends, a line in the thread with what went ahead, and it asks again.
- **B+C**: B's chip, C's escalation on the card, which sets the chip.

In every path the waiting prompts clear the way the runtime would: allowed, except a command Althar can't read, which goes back to the lead to spell out while meridian's Never names anything (3 of the 7 here). Never still holds, and no lead reads credentials or reaches the code host.
