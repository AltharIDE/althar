# ADR-099: A turn's work is one live line, then folds; streamed text comes at an even pace and fades in; a review is a line

- **Status:** Accepted; revised 2026-11-07 (the first version streamed the turn's thinking under its line)
- **Date:** 2026-11-06
- **Owner:** Repository maintainers
- **Context:** Althar keeps the person's attention out of agents'
  thinking: a turn's work folds under one line, and a thread reads as what
  was asked, what the lead did and its handoff ([ADR-042](042-a-task-s-thread-reads-in-rounds.md)).
  That left nothing to watch while an agent worked: a shimmering
  "Thinking", then a fold whose thoughts said only "Thought". Text arrived
  in whole copies as the runtime streams it (at most every 50 ms, with the
  stalls a model's stream has), and drew in bursts. Each review round stood
  in a task's thread as a block of its own, its verdict, findings and
  summary in full, with the lead's settling after it, so after two or three
  rounds the lead's handoff was buried under reviews the person rarely
  reads. Codex's app was the reference the person named.

  The first version (6 November) read that as showing the thinking: the
  latest thought streamed under the turn's line, folding to "Thought for
  14s · what about" as the agent moved on. The person found it ugly and not
  what they meant: a task's running round stacked a "Working · 2m 28s · …"
  line, with the lead's last words cut off mid-sentence on it, over a
  "Thought · …" line of its own, each with its own icon. They recorded
  Codex's app to show it (7 November): "Thinking" alone where the reply
  goes; then one quiet header, "Working for 8s", a hairline under it, the
  agent's own words in the thread's voice, and one quiet line with a small
  icon for what it is doing now ("Reading MEMORY.md"), replaced in place,
  never a list, with no thinking shown and no row for it; as the answer
  starts, all of it folds under "Worked for 19s ›", which opens to the whole
  trail, and the answer's newest words come in dim and brighten.
- **Decision:**
  - **A turn at work is one header, its words and one live line.** In a
    task's thread and the coordinator's alike (`WorkedFor`): before
    anything, "Thinking" where the reply will go, as before. Once it works,
    "Working for 8s", counting, a hairline under it; under that, what the
    agent has said on the way, in order, as it said it, in the thread's
    own voice; then one quiet line for what it is doing now (`WorkNow`): the
    tool it runs, or ran last, as it runs ("Reading MEMORY.md", the tool's
    icon), until the next replaces it; or, thinking, what about, by the
    thought's latest heading where it has one (Codex's), else "Thinking",
    with no icon. A plan or Althar's notes aren't steps. What it is writing
    now stands under all that, where its answer will, and the line goes
    while it writes. The header opens the whole trail at any time; its
    chevron shows once the turn is over, and to the pointer or the keyboard
    while it runs.
  - **Once it answers, it folds.** As the turn ends, what it said on the
    way and the live line fold away under "Worked for 19s ›", and what it
    said last stands under it, in the place it was written, so it never
    draws again. A task's round knows its answer sooner: a lead writes its
    handoff after its report, so once it writes after its report, its work
    folds and its time stops there. A round stays one round from its report
    to its answer, its report's words held back while it may still write
    one. The coordinator's turn folds as it starts its answer, its time
    stopping there: Codex says of each message whether it is its final
    answer or commentary, and codex-acp passes that on, from a message's
    first words, to a JetBrains AIR client, as Althar is (`answerOf`), so
    Althar keeps it on the message (`answer`). Claude Code and OpenCode say
    nothing of it, so what such a turn writes after its work is taken for
    its answer once it is more than a word on the way: longer than a
    sentence or two (280 characters), or with a list, a heading, a table or
    code (`answers`); a short answer folds as the turn ends. Should a step
    follow after all, it was a word on the way, and the work goes on, open.
    Opened while it ran, the work folds as it ends all the same, and opens
    again on a click. A finished thread shows only the headers and the answers;
    a round's acknowledgement is part of its work now. What needs the
    person (a stuck step, a question, a permission, an error and its way
    out) never folds. The fold asks one thing of the agents: what stands
    open, a lead's last message (or its report, where it writes nothing
    after it) and the coordinator's answer, carries everything the person
    needs from the turn in full, the proposal, every question, the
    findings, the decisions needed and what was built or not, and never
    points back at what folded ("see above"); each role's brief says so,
    and a lead whose last message only points back is told once to say it
    again (`lastMessage.ts`, 8 November).
  - **Thinking shows only in the trail.** Opened, every thought is a line,
    "Thought for 14s · what about", or what it is on while it thinks, and
    opens to its words; none shows unasked, and none has a row of its own
    while the turn runs. What a thought is about comes from the thought, not
    a model: Codex's latest heading, or the first sentence of Claude Code's
    and OpenCode's thinking; a call per thought would cost more than the
    line is worth.
  - **Streamed text comes at an even pace, its newest words fading in.**
    What has arrived is held and shown on the screen's frames, at the pace
    it has been arriving (what came in the last second and a half), a whole
    word at a time, so no word starts on one line and jumps to the next;
    behind by more than half a second's worth it speeds up, and seconds
    behind it catches up within a few frames; done, it shows whole at once
    (`lib/pace.ts`). Each stretch that shows comes in dim and brightens over
    `--stream-in` (700 ms), so the newest few words read as a trailing
    gradient and the text flows rather than pops (`Markdown/fresh.tsx`): a
    stretch is kept by where it stands in the source, what shows within
    50 ms joining it, its fade going on if its block is drawn again, and it
    is drawn as plain text once it has brightened; only the blocks still
    fading are placed. The first words of
    a text drawn as they start fade in too; a text opened mid-stream shows
    what was there at once. Half-written markdown is held back where it
    would change its mind (a lone list marker, a table's first row before
    its rule, a fence's first line) and an open mark is closed for now
    (`Markdown/streaming.ts`), and only the block being written is read and
    drawn again (`Markdown/lexed.ts`). With reduced motion it shows as it
    arrives, with no fade. The pacing follows Codex's terminal
    (`codex-rs/tui/src/streaming/chunking.rs`): pace by what is queued and
    how old it is, catch up when either grows, flush at the end; its unit is
    a whole rendered row, ours a whole word, since a page wraps as it goes.
  - **A review is a line.** In a task's thread each review is one quiet
    line: who reviewed, what it found and what became of it ("Review ·
    GPT-5.2 · 3 findings · 2 fixed, 1 declined"), opening to its findings
    and words. The lead's round settling it folds into that line once a
    later round of the lead's handed the work over again; the lead's
    latest handoff, on the work or on settling a review, always stands
    open. A review running is a line at the thread's end, turning, with
    nothing of the reviewer's thinking (it runs in a thread of its own).
- **Alternatives considered:**
  - **The latest thought streaming under the turn's line, folding to a line
    of its own** (this ADR's first version). Two status rows stacked, the
    lead's words cut off on one, the thinking shown raw: not what Codex
    shows, nor what the person asked for.
  - **Every thought open while the turn runs.** It is the spam the person
    named: a long turn's thinking would fill the screen.
  - **Only the latest of what it said on the way, replaced as it says
    more.** Each replacement would move everything under it; what it said
    stays, in order, until the turn folds.
  - **Folding as soon as the coordinator writes, taken for its answer.** A
    tool after it would unfold it again, and the next message fold it: the
    work would flicker open and shut on every word said on the way.
  - **Folding the coordinator's work only as its turn ends.** Honest where
    the agent doesn't say, but what it said on the way, and the clock, stand
    over its whole answer as it streams, not the shape the person asked for;
    Codex says, and Claude Code's answers are seldom a sentence.
  - **A summary written by a small model for each thought.** Better words
    for Claude's thinking, at a model call per thought, and a wait before
    the line has them.
  - **Fading the end of the text by a mask over its last line.** It fades
    where the text ends, not what is new: a stall leaves the last words dim,
    and a line's start never fades.
  - **Folding every settle round into its review.** The latest is the
    lead's handoff, often the one the person needs on opening the task.
- **Trade-off:** Where the agent doesn't say which message is its answer,
  the coordinator's work folds a sentence or two into it, and a long word on
  the way between steps folds the work until the next step opens it again;
  a short answer folds only as the turn ends. A round's
  acknowledgement no longer stands open once it hands over; the handoff
  says what it did. The pace trails what has arrived by a burst or so,
  about a fifth of a second at a model's usual pace, and drawing on every
  frame costs more than drawing on each copy: on a build, three long answers
  streaming at once took 2.5 ms of the main thread a frame against 1.25 ms
  before, at a steady 60 frames a second. The fade draws the newest words
  in spans of their own, placed in the source each frame while they fade:
  on a build, the same three took 2.1 ms a frame with it against 1.7 ms
  without (7 November, on the same computer), still dropping no frame;
  a span a frame, before stretches joined, took 3.6 ms. A first sentence is a rough summary of a long thought.
  What became of a review's findings is read from what the reviews found,
  one read per review that found something, again as each step reports.
- **Related:** [ADR-042](042-a-task-s-thread-reads-in-rounds.md) (rounds; a
  reviewer's verdict now stands as a line, and an acknowledgement folds with
  the work), [ADR-069](069-motion-is-one-system-named-by-what-happens.md)
  (motion), [ADR-076](076-a-pull-request-shows-the-review-its-change-had.md)
  (a pull request shows the review its change had, as before).
- **Revisit when:** Claude Code's or OpenCode's adapter says which of its
  messages is its answer, as codex-acp does; Claude Code's adapter passes on
  summarized thinking with headings of its own; the person wants earlier
  handoffs folded too; or a review's findings need the person more often
  than the line lets on.
