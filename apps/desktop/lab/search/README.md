# The search lab

Search across Althar, three ways, over the whole desktop app: its router, tabs and screens, on made-up data with no runtime (`world.ts`: three projects, althar's with its real recent pull requests, issues, notes and files, a conversation with each coordinator and a thread for each task). ⌘K (Control-K off a Mac) opens search as the app does; one import seam in `vite.config.ts` swaps the app's finder for the lab's. What search finds opens the real screen: a task, a project's view, a setting, the thread scrolled to the message it found.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/search/vite.config.ts
```

At `http://localhost:6161`. The bar along the bottom picks what ⌘K opens: 1 Today, 2 A, 3 B, 4 C, wherever nothing is typed; with the box open, Alt with 1–4 swaps it in place and keeps the words, so one search reads in each. Its Try buttons type a search for you. `w` switches between a wide window and the app's narrowest (880 px), and `m` how A moves: Morph, Slow ×5 (every animation at a fifth of its pace, to watch each morph) or Still (as DESIGN.md has the command menu today). The address keeps it all: `?d=B&narrow=1&m=slow#/threads/th_cap-parallel-agents-per-machine`. Actions that would change work (push, merge, allow) say what they would have done in a line instead.

## What makes the best searches work

From Raycast, Linear's ⌘K, Superhuman, Arc's command bar, VS Code's quick open, Slack's switcher and GitHub's command palette:

1. **Instant, or it isn't used.** It opens in a frame and answers every key from what's already in memory, with no spinner and no pause (Superhuman's 100 ms rule, Linear's local sync, VS Code). Here, a search over 1,338 things takes under 1 ms.
2. **One key on every screen, and it knows where you are.** What's in front of you ranks first: Linear's ⌘K acts on the open issue, Superhuman's on the open email, Arc ranks open tabs above history.
3. **The empty box is the most-used screen.** With nothing typed it shows what you'd want now: recents, what's waiting, this screen's actions (VS Code's recently opened, Raycast's favourites).
4. **Rank by habit, then by text, and hold still.** Frecency puts the same top result under the same few letters every day, so "lig ↵" becomes muscle memory (Raycast, Alfred, Slack). Results never reorder under the key you're about to press.
5. **Forgiving, and exact when it can be.** Word starts, initials ("scf" for small changes fast) and plurals all match; a key (#845, DEV-58, a branch) jumps straight to its one thing (Linear, GitHub).
6. **Find and do in one box; every row acts.** Enter does the obvious thing and a second key lists the rest (Raycast's action panel, Linear's nested commands). Commands show their own shortcut, so the box teaches you to skip it (Superhuman, Linear).
7. **Narrow by typing, not with filter controls.** A prefix or Tab turns the box into one kind (VS Code's `>` `@` `#`, GitHub's `#` `/` `>`, Raycast's Tab, Slack's `in:` `from:`). Newcomers never need it; experts live in it.
8. **Show why it matched.** The matched letters darker, where it is and where it stands, and for long things the passage, enough to choose without opening. Group by kind, a few each, with a top hit across them, and one thing on one row.
9. **A way out when nothing matches.** Fallbacks do something with the words: Raycast's search the web or ask AI, Arc's search Google. Here, ask the coordinator.

Althar today has ⌘K, but it finds tasks only, by their words (SQLite's full-text index), after typing pauses for 120 ms and a round trip to the runtime. Pull requests that aren't a task's, issues, notes, what was said in a conversation, files and actions can't be found, and nothing can be done from it. "Today" in the bar is that finder, on the same data.

## The directions

**A · One box** (Raycast, Linear, Spotlight). One field finds every kind and does every action. A top hit, then groups by kind, a few each, ordered by their best match; a task stands for its own pull request and issue. Every row acts: Enter does the obvious thing, → (or ⌘K again) lists the rest in place, with Allow first on a task waiting for a permission and Merge on one ready. Empty: this task's actions, Needs you, Recent, Actions with their keys, and Search only (the kinds to narrow to, each with its character). Words that ask something put "Ask the coordinator" first. *Bets on one key to learn and doing things without leaving the keyboard.* Risk: breadth makes the list busy, and kinds compete for the top.

The person picked A, shaped after Linear's ⌘K, with morphs. So A now also takes the recommendation below in: the words first with no icon or rule, "Ask the coordinator Tab" at the field's end as Linear's "Ask Linear", B's first characters as typed narrowing (`#` `/` `"` `!` `>` grow into a chip; Backspace on an empty field takes it away), and C's passages and ask-first. Tab asks the coordinator with the words, listing what it will read first (the passages that match); Enter sends them to the coordinator's composer.

### How A moves

Each morph keeps the identity of what was chosen as it goes somewhere else, on the kit's own springs (`--move`, `--slide`, `--enter`, `--exit`), moving only transform and opacity (but the box's height, as the kit's `SizeMotion` does), turning back mid-way when the next key comes, and only fading with reduced motion (`morph.ts`, `morph.css`):

- **Opening** grows the box from 96 % and fades it in; **closing** fades it out, quicker.
- **The highlight** is one surface under the chosen row that slides to the next on `--slide`, for keys and the pointer alike.
- **The list** moves as a whole (the kit's `ListMotion`): as the words change, a row that stays slides to its new place and a new one rises in.
- **The box's height** glides to what it now lists, rather than jumping.
- **→ a row's actions:** the row's name lifts into the field as a chip, its pill growing on the way, while the actions rise in under it. **← back:** the chip drops into its row again, the pill fading as it lands.
- **A first character** (`#`) grows into its chip, the words keeping to its edge. A Search only row chosen lifts into the chip as a row's name does, and drops back into it.
- **Tab:** "Ask the coordinator" slides from the field's end to its start and becomes the chip; Tab again sends it back.
- **Enter** carries the row's name into the page it opens, as the page's title (the browser's view transitions): the box fades, the page crossfades, and the name lands in the title bar. Asking carries the field into the coordinator's composer.

DESIGN.md has the command menu still ("there at once", "Leave still what happens many times a day or by key"); the person asked for morphs. Nothing here waits on motion: every key is answered in the same frame, results are there at once and only their places glide, and every motion yields to the next key. The one wait is Enter's view transition, which holds the old picture until the page has drawn its title, up to 360 ms (in the lab it's drawn in a frame or two). If A is built this way, that line of DESIGN.md and the Motion section of `docs/decisions/desktop-app.md` ("The command menu, opened by key many times a day, is there at once") change with it, and `ListMotion`, `SizeMotion` and `lib/motion` get exported from the kit (the lab imports them from its source).

**B · Scopes** (VS Code's quick open, GitHub's palette). The box goes to things by name: tasks, projects and their views, settings, one flat list by habit. A first character scopes it: `>` actions with their keys, `#` pull requests and issues by number (`#84` lists #840 to #847), `/` files by path, `"` what was said, `!` notes, `@` a project. A strip under the field shows every scope, so it teaches itself; Tab steps through them. *Bets on precision and speed for someone who searches fifty times a day: each list one kind, drawn for that kind.* Risk: you have to know which kind you want, and a newcomer finds nothing said without a scope.

**C · What was said** (Superhuman's search, Slack's, a mail client's). It searches the words inside everything (conversations, reports, notes, issues) and shows the passage, grouped by where it was said: each task or conversation once, its best passages under it. The chosen passage opens in place to the whole message; Enter opens the thread scrolled to it, tinted a moment. A question drops its filler words and puts "Ask the coordinator" first. `in:` `from:` `is:` narrow it. *Bets that what you remember in Althar is what was said or decided, not titles.* Risk: no actions, and it's a heavier box for a quick jump.

## Recommendation

Build **A**, taking the best of the other two into it (the person agreed, and A in the lab is now this):

- B's prefixes as typed shortcuts for A's Tab narrowing (`>` actions, `#` numbers, `/` files), with no strip of scopes on screen.
- C's passages for what was said and notes: the matched words in context, Enter opening the thread at the message, and Ask the coordinator first for a question.
- An index in the window, as the lab's is, not a runtime round trip per key, with the habit (what was opened, how often, how lately) kept.

Today's finder can grow into it a step at a time: pull requests, issues, notes and conversations first, then actions.
