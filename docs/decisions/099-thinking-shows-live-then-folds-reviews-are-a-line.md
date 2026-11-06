# ADR-099: Thinking shows while it happens, then folds to a line; streamed text comes at an even pace; a review is a line

- **Status:** Accepted
- **Date:** 2026-11-06
- **Owner:** Repository maintainers
- **Context:** Althar keeps the person's attention out of agents'
  thinking: a turn's work folds under one line, and a thread reads as what
  was asked, what the lead did and its handoff ([ADR-042](042-a-task-s-thread-reads-in-rounds.md)).
  That left nothing to watch while an agent thought: a shimmering
  "Thinking", then a fold whose thoughts said only "Thought". Text arrived
  in whole copies as the runtime streams it (at most every 50 ms, with the
  stalls a model's stream has), and drew in bursts. Each review round stood
  in a task's thread as a block of its own, its verdict, findings and
  summary in full, with the lead's settling after it, so after two or three
  rounds the lead's handoff was buried under reviews the person rarely
  reads. Codex's app was the reference the person named: it shows the
  thinking while it happens and folds it once it is done.
- **Decision:**
  - **Thinking shows while it happens, then folds.** While a turn runs,
    its latest thought shows under its work's line, in the thread's
    quietest voice, capped to its last few lines, the oldest fading out at
    the top; its line says what it is on, its latest heading where it has
    one. When the agent moves on, it folds to one line: "Thought for 14s ·
    what about", the whole of it a click away. Once the agent starts its
    answer, and once the turn ends, the line folds away into the work, where
    every thought is such a line. A thread read later shows only folded
    thoughts. Collapsing is a fold, not a jump, and holds a scrolled-up
    reading position.
  - **What it was about comes from the thought, not a model.** Codex's
    thoughts are its model's reasoning summary, each part under a bold
    heading: the latest whole heading is what it is about, as Codex's own
    terminal shows it. Claude Code and OpenCode give the thinking itself:
    its first sentence, plain and short. No model is asked: a call per
    thought would cost more than the line is worth.
  - **Streamed text comes at an even pace.** What has arrived is held and
    shown on the screen's frames, at the pace it has been arriving (what
    came in the last second and a half), a whole word at a time, so no
    word starts on one line and jumps to the next; behind by more than half
    a second's worth it speeds up, and seconds behind it catches up within a
    few frames; done, it shows whole at once (`lib/pace.ts`). Half-written
    markdown is held back where it would change its mind (a lone list
    marker, a table's first row before its rule, a fence's first line) and
    an open mark is closed for now (`Markdown/streaming.ts`), and only the
    block being written is read and drawn again (`Markdown/lexed.ts`). With
    reduced motion it shows as it arrives. The pacing follows Codex's
    terminal (`codex-rs/tui/src/streaming/chunking.rs`): pace by what is
    queued and how old it is, catch up when either grows, flush at the end;
    its unit is a whole rendered row, ours a whole word, since a page wraps
    as it goes.
  - **A review is a line.** In a task's thread each review is one quiet
    line: who reviewed, what it found and what became of it ("Review ·
    GPT-5.2 · 3 findings · 2 fixed, 1 declined"), opening to its findings
    and words. The lead's round settling it folds into that line once a
    later round of the lead's handed the work over again; the lead's
    latest handoff, on the work or on settling a review, always stands
    open. While the lead settles a review it works quietly: its thinking
    stays folded. A review running is a line at the thread's end, turning,
    with nothing of the reviewer's thinking (it runs in a thread of its
    own). What needs the person (a stuck step, a question, a permission)
    stays where it was: none of it is in a review's line.
- **Alternatives considered:**
  - **Every thought open while the turn runs.** It is the spam the person
    named: a long turn's thinking would fill the screen.
  - **A summary written by a small model for each thought.** Better words
    for Claude's thinking, at a model call per thought, and a wait before
    the line has them.
  - **Fading each word in.** DESIGN.md leaves words as they stream still;
    the even pace is what makes it smooth, not motion.
  - **Folding every settle round into its review.** The latest is the
    lead's handoff, often the one the person needs on opening the task.
- **Trade-off:** The pace trails what has arrived by a burst or so, about
  a fifth of a second at a model's usual pace, and drawing on every frame
  costs more than drawing on each copy: on a build, three long answers
  streaming at once took 2.5 ms of the main thread a frame against 1.25 ms
  before, at a steady 60 frames a second. A first sentence is a rough
  summary of a long thought. What became of a review's findings is read
  from what the reviews found, one read per review that found something,
  again as each step reports.
- **Related:** [ADR-042](042-a-task-s-thread-reads-in-rounds.md) (rounds; a
  reviewer's verdict now stands as a line), [ADR-069](069-motion-is-one-system-named-by-what-happens.md)
  (motion), [ADR-076](076-a-pull-request-shows-the-review-its-change-had.md)
  (a pull request shows the review its change had, as before).
- **Revisit when:** Claude Code's adapter passes on summarized thinking with
  headings of its own; the person wants earlier handoffs folded too; or a
  review's findings need the person more often than the line lets on.
