# ADR-041: A task's thread reads in rounds: an ask, then what its lead says first, its work in a line, and what it says last

- **Status:** Accepted
- **Date:** 2026-10-15
- **Owner:** Repository maintainers
- **Context:** A task's thread was hard to follow. Everything one agent did
  in a row was one turn, however long: an hour of work and forty messages
  folded under one "Worked for", and only its last message stayed open,
  often a line said on the way ("Reading the tests:"). The runtime paged a
  thread by its newest hundred items, so a long task opened on that one fold
  and "Earlier in this task", with the person's own messages behind it. Each
  step's report was a card ("Step 1 of 2"), and a second card closed the
  thread with what the task built; the lead never ended on a message. The
  screenshots under a turn were nearly all the lead looking at its own
  pictures to check its work (every one, on 14 October's threads), gathered
  four at a time behind Show all, retakes and broken states among them. What
  the coordinator passed on to a lead was a notice written as it was queued,
  in the middle of the turn the lead only read it after, so a second round
  of work seemed to come from nowhere; the person's own messages sent while
  a turn ran sat where they were sent, too. Prototyped on six real threads
  from Althar's store and reviewed live, 15 October.
- **Decision:** a task's thread reads in rounds, on the screen and in what
  the runtime pages.
  - **A round starts with an ask:** what the person says, what the
    coordinator passes on, a review's findings, or Althar asking the lead to
    settle a conflict or fix its checks. The lead answers it in at most
    three parts, a breath apart: what it said first, when it said it soon,
    before changing anything and with work after it (its acknowledgement);
    one faint line for all its work ("Worked 12m · edited 3 files, ran 6
    commands"), which opens to every step in order on a quiet sheet, what
    it said on the way among them, and leaves nothing under it closed; and
    what it said last, with what its report showed. While it works, the
    line says what it is on, in its own last words. A round that said
    nothing is that line alone, with who worked.
  - **A report is the lead speaking.** What it built is its result where it
    said nothing after it; where it did, what it said is. Under it, every
    screenshot it handed in, large, two across and wider than the words,
    each with its whole caption, in the groups their names make ("A1 · One
    quiet line: …" heads a group); a view it showed before and took again is
    named in a line, not shown twice, and a table in its message that only
    lists the shots goes. Then what it checked, a line each opening to what
    it printed, and what it couldn't. No step cards, and no card closes the
    thread. A reviewer speaks in its own voice: its verdict in a sentence,
    each finding how much it matters, where, and what.
  - **What the lead looks at stays with its work.** A picture its own tool
    read shows small under that step, inside the line; only what it hands
    in, or puts in a message, stands with what it says.
  - **What the coordinator passes on is an ask.** The runtime writes it into
    the task's thread when the lead receives it, at the start of the turn it
    is delivered in (a notice with `role: 'relayed'`), and the screen draws
    it on the person's side, under "From the coordinator": what it is in a
    line, three lines of the rest, and all of it on a click, with Althar's
    mark printed faint in its corner. What the person says while a turn
    runs moves to where the lead read it, the same way.
  - **Althar's notes.** Its housekeeping along the way (a branch made, the
    task made a change, a loop stopped) is a notice with `role: 'aside'`,
    kept inside the work's line, as a worktree set up as it should be is. What the person should know (a conflict,
    failed checks, a conflict it couldn't settle, a pull request opened) is
    one line with Althar's name, a list of files said as how many.
  - **A page starts at a round.** The runtime still reads a task's thread a
    page at a time, but a page reaches back to the ask of the round its
    first item is in, so a task opens on whole rounds, at least the last one.
  - **The lead is asked for it.** Its instructions say: when it picks up an
    ask, say first in a sentence or two what it understood and what it will
    do; say little while it works; end with a message saying what it did,
    what to look at and what is left; show each screenshot once, and never
    list them in a table.
- **Alternatives considered:**
  - **Every message open, the work between two messages a line each.**
    Prototyped first: it read like a terminal session, a lead that narrates
    filled the thread with "Now the tests:" between lines of work, and the
    person had to read it all to find the result.
  - **A panel beside the thread for the work, or a status line over the
    composer.** A panel takes the width a document needs, and the person
    dislikes side panels; a status line repeats the header's state and
    leaves the thread without the work when it is done.
  - **Milestones the lead writes as it goes.** Asks the lead for structure
    the person doesn't want imposed, and depends on it every time.
  - **Placing what the coordinator passed on in the window, by delivery.**
    The window reads a thread a page at a time and doesn't know deliveries;
    the runtime does, and writes it once, where it belongs.
- **Trade-off:** The acknowledgement is read from what the lead said first,
  so a lead that starts with work and speaks only later has none, and one
  that narrates early may have a line on the way taken for it; the
  instructions ask for one, but nothing makes it say one. A view "taken
  again" is known by its name in the caption, which leads use for
  prototypes; pictures without names are always shown. What the person
  says while a turn runs now moves in the thread when the lead reads it.
  Threads written before roles keep their notices where they were; the
  screen reads the old ones by their words.
- **Related:** [ADR-034](034-a-task-goes-back-to-work-and-ships-again.md)
  (a round of work after the plan), [ADR-018](018-allow-always-keeps-a-rule.md) (the
  line saying what the project's rules let through, under a round's work).
  The coordinator's own thread still reads in turns.
- **Revisit when:** leads talk to the person mid-task in ways the three
  parts can't hold (asking something without a question, say); the
  coordinator's thread wants the same; or people want earlier rounds folded
  to their ask and answer.
