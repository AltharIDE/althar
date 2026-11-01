# ADR-081: A welcome on first launch: a short tour, then setup in steps, and a new project asks for what it will need

- **Status:** Accepted
- **Date:** 2026-11-01
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
    components with notes pinned to its parts: you ask the coordinator,
    agents from different makers build, only the calls come to you, and the
    work is reviewed by another maker's agent before you see it, with the
    seal its pull request carries (ADR-076). Skip leaves it. Once seen on
    this computer (`althar.toured`), it is left out of later first screens.
  - **Then the setup, one thing a step:** the agents on this computer, a
    row each, signed in from their own row by their own walk, and the
    others as tiles to download; the first project, of the repositories
    found or folders added; where its code is, for pull requests; and a
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
    Each walk in opens in the card. It goes once the conversation begins,
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
- **Trade-off:** the welcome is longer than Start was (eight steps with the
  tour), though the tour is one press to skip and shown once. The project
  exists before the last two steps, so a window closed there opens on the
  home, where the project's card asks the same.
