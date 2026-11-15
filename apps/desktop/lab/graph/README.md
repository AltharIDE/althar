# The graph lab

A request the coordinator split into tasks, as a live graph of them (DEV-230, for DEV-223), four ways, over the whole desktop app: its router, tabs, board, coordinator's thread and task pages, on a made-up runtime where the request plays out (`world.ts`). A task waits until what it depends on has merged, starts by itself, works, is reviewed, runs its checks and waits for the person's merge; one asks the person to allow a command, one fails a check and fixes it, and in the twelve-task request one fails for good and leaves what depends on it stuck. The real board moves as it goes.

```bash
cd apps/desktop && ../../node_modules/.bin/vp dev --config lab/graph/vite.config.ts
```

At `http://localhost:6171`. The bar along the bottom:

- **1–4** where the graph is drawn (A–D).
- **2 / 6 / 12 tasks** which request plays (`n` steps through them).
- **Space** plays and pauses; the slider scrubs; Shift with ← → steps a minute; **0** starts again; the speed button cycles 1×, 2×, 4×. A minute of work is a second at 1×. At the end it rests a moment and plays again.
- **w** the app's narrowest window (880 px).

Pointing at a task opens its detail: who leads it, what it waits for, what merging it starts, and what can be done there (Start now, Don't wait for one of what it waits for, Hold, Allow, Merge, Try again), which the run then follows. Pressing a task opens its page. The address keeps the direction and request: `?d=C&s=twelve`; `&t=48&paused=1` holds it at a minute, `&face=request` opens tasks on C's view.

Everywhere, a task held for others says so in Up next ("Waits for API and Charges", after the board's mark for after) and in its page's header, as the runtime will once tasks depend on each other (DEV-228).

## The directions

**A · In the conversation.** Where the coordinator answers the request, one card holds the tasks it became, in place of a plan card per task. Drawn top to bottom: what starts first at the top, each task under what it waits for, a line from each. Each task says where it stands in a word; one not started is an outline with dashed lines in; merged ones step back. The card's last row is what waits on the person now (Allow Charges: docker compose up; Merge #415 to start Checkout; Try Import again), done right there. It fits the conversation's width with 12 tasks and in the narrow window. *Bets on the answer being the place to look: the graph is where the request was made.* Risk: it scrolls away as the conversation goes on.

**B · Over the board.** Each request in flight is a band over the board's lanes: its tasks left to right in the order they can start, a mark and a name each. Pointing at a task in the band outlines its card below; pointing at a card lights it in the band. Folded, it's one line with what needs the person. Where names don't fit (beside the conversation, narrow), each task is its mark alone. *Bets on glancing at the board.* Risk: several requests at once stack several bands over the lanes.

**C · On a task's page.** Each task of a request gets a Request view beside Conversation and Outputs (`r`): the request in the person's words and the whole graph on the Graph view's dotted canvas, this task ringed. Each task has room to say more: where it stands, its pull request, who leads it and for how long. Pressing another task goes to its page on the same view, so the graph can be walked. *Bets on context from inside the work.* Risk: one more view, and only reached from a task.

**D · Lines on the board.** Nothing new to look at: the board's cards are the graph. At rest it is the board, with each waiting task saying what it waits for. Pointing at a card of the request draws its lines (what it waited for, what waits for it) between the cards themselves, and the rest of the board steps back. *Bets on the board already saying where each task stands.* Risk: the order is only seen while pointing; lines at rest were tried and read as scribble in the narrow gaps between lanes.

## Recommendation

**A, with C behind it.** DEV-230 asks for the graph from the plan card and from each task: A is the plan card become the graph, and C is the same graph from each of its tasks. Take D's words with them whichever is picked: Up next and a task's header saying what it waits for cost nothing and answer "why hasn't this started?" where the person already looks. B is the one to add if the person wants the graph always in sight on the board.

## Pictures

`shoot.ts` shoots it headless at 1×, into `lab/graph/shots` (git ignores it), with the lab running. Chromium can't start in an agent's sandbox on a Mac; run it outside.

```bash
node lab/graph/shoot.ts stills            # each direction with 2, 6 and 12 tasks, narrow too, a task's detail, D pointed at
node lab/graph/shoot.ts frames A six 1.5  # a frame each 1.5 minutes of work, for a recording
cd lab/graph/shots && ffmpeg -framerate 5 -i frames-a-six/%03d.png -vf "tpad=stop_mode=clone:stop_duration=2,scale=1080:-1:flags=lanczos,split[x][y];[x]palettegen=max_colors=96:stats_mode=diff[p];[y][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" a-six-live.gif
```

## How it's put together

`vite.config.ts` swaps two imports in `ProjectView` (the coordinator thread's task card, for A; the board, for B and D) and patches a few lines in `BoardView` and `TaskView` (Up next's and the header's words, and C's view), each named there; nothing in `src` changes. `view.ts` turns the simulation into what every direction says (words, lines, columns) and lays the graph out; `graph/parts.tsx` draws a task's mark, its detail and the lines, from the kit's own pieces.
