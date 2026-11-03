# ADR-083: A welcome on first launch: a short tour, then setup in steps, and a new project asks for what it will need

- **Status:** Accepted
- **Date:** 2026-11-01
- **Amended:** 2026-11-02: the tour rethought, not patched. Tried on a fresh
  profile, its first scene hung outside its card (the agents' marks past
  its left edge, its lines out of its right), its first page asked rather
  than introduced, and the makers' page named three agents of the ten
  Althar runs. Asked how to introduce someone to the whole app, the
  question became what a developer who already uses Claude Code, Codex or
  Cursor has to believe before their first message. Three directions were
  offered (a tour then the setup; each setup step teaching its part; one
  page with the whole loop). The person picked the tour, asked for a page on
  what a project is and for it to come first, dropped the page on the calls,
  and asked for the project step to find a repository by typing. The tour
  is now four pages, its scenes drawn at their real size and made smaller
  only where the window is, with nothing pinned outside them; the agents'
  step heads those here and those not alike; the project step is folder
  first, with a field that finds. The new project's card sets a walk in from
  its own left edge, as Settings and the welcome's code and issues steps
  now do, and glides to its new height as it changes.
- **Owner:** Repository maintainers
- **Context:** Friends and colleagues are about to get the app (GTM-20). A
  fresh install opened on Start: the agents round the mark, and the
  repositories found, ticked into the first project. Nothing said what
  Althar is, and nothing asked for a code host or a tracker until a task
  needed one. The kit had a tour, the Welcome on a drafting table, which the
  app never showed. Prototypes offered a single sheet, a few steps, help in
  the project itself, and a sheet followed by help in the project; then
  three places for a tour within the steps. The person picked steps with
  the tour as its first pages, asked for code hosts and trackers as two
  steps, a page on the review a change gets in place of the one on merging,
  and kept the new project's card for what wasn't connected.
- **Decision:**
  - **The first screen is the kit's Welcome: one card of steps** (the
    Welcome screen, wired in `features/start`). It keeps its size from step
    to step, with a track of its steps along its head.
  - **It opens on a tour of four pages,** each a scene of the real
    components, played once and drawn at its real size where the window
    allows: **work happens in projects** (repositories wired into one, with
    its coordinator, board, rules and notes, and its tasks out of it, each
    on a branch and a copy of its own); **meet the coordinator** (you ask,
    it plans a task and gives it a lead, it writes no code, and only what
    needs your decision comes back); **agents from different makers** (a
    mark for every agent Althar runs, from the runtime's list, under the
    line, and one task's steps across two makers); and the work is
    **reviewed before you see it**, by another maker's agent, with the seal
    its pull request carries (ADR-076). The project comes first because
    everything after happens in one. Skip leaves it from any page. Once
    seen on this computer (`althar.toured`), it is left out of later first
    screens.
  - **Then the setup, one thing a step:** the agents on this computer, a
    row each, signed in from their own row by their own walk, and the
    others as tiles to download, both headed alike; the first project, a
    folder chosen first, then the repositories found where people keep
    code, with a field that finds one by its name or place, focused as the
    step arrives (↓ and ↑ walk into the rows, Return ticks); where its code
    is, for pull requests; and a
    tracker, for issues. The last two are the connections list, one kind a
    step, and both can wait. Where no tracker can be connected there is no
    issues step. Only the project is needed: a project can be made with no
    agent ready.
  - **The project is made on its step, and the welcome stays on show over
    it** (`welcome.ts`) until its last step opens it, so the code host's
    walk can name the project's own repository. The window's tabs stay
    hidden meanwhile. Left with its project made, the welcome is over: the
    next launch goes to the home.
  - **A new project's empty conversation asks for what its tasks will need
    later** (FirstConnections): the code host its repositories' remotes
    name, or every host where they name none, and the trackers behind one
    menu, so the card stays two rows however many services there are.
    Each walk in opens in the card, from its left edge with the way back on
    it too, and the card's height glides as it goes from its rows to a walk
    and from step to step (ADR-069's move spring; still with reduced
    motion). It goes once the conversation begins,
    once both are connected, or by Not now, kept for the project
    (`althar.firstConnections`).
- **Alternatives considered:**
  - A single sheet with everything on it: quick, but it said little about
    what Althar is, and a sheet of connections reads as homework.
  - Help only in the project, with the first screen asking for a folder:
    a missing agent would be found only when the first message failed.
  - The drafting-table tour before the steps: the richest, but a second,
    very different screen before the setup, and long. Its scenes are kept;
    its camera and opening are gone.
  - Making the project at the end: the code host's walk couldn't name the
    project's repository, and Code and Issues would come before what they
    are for.
  - Each setup step teaching its part, with only the coordinator a page of
    its own (2026-11-02): the shortest, but the review and the makers came
    as asides to setup, and the agents' marks would show twice.
  - One page with the whole loop, its scene in three beats (2026-11-02):
    one press from the setup, but too much on one page to take in.
  - A page on the calls, the board with one decision waiting in Needs you:
    dropped (2026-11-02); the coordinator's page says it in a line.
  - Notes pinned to a scene's parts, and a pointer pressing them: they hung
    outside the card at small windows, and narrated what the scene showed.
- **Trade-off:** the welcome is longer than Start was (eight steps with the
  tour), though the tour is one press to skip and shown once. Its scenes are
  demo data, Meridian's, not the person's own. The project
  exists before the last two steps, so a window closed there opens on the
  home, where the project's card asks the same.
