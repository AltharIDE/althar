# ADR-014: The window keeps what it read, and a screen reads before it shows

- **Status:** Accepted
- **Date:** 2026-10-07
- **Owner:** Repository maintainers
- **Context:** Moving around the desktop app flickered. Recording every
  painted frame showed what each move did:
  - every screen began empty;
  - the home drew a blank window with a spinner, then an empty home ("nothing
    waits on you"), then the real one;
  - a task showed a spinner for about a tenth of a second on every visit;
  - one project's screen showed the last project's content for a frame.

  The reads weren't slow: most came back within a frame, since the runtime
  is a local process with its store on the same disk. The flicker came from
  the window:
  - each view model held its reads in its own state, which went when the
    screen did, so every visit started from nothing;
  - each read began after the first paint, so even a read of a millisecond
    showed a frame of placeholder;
  - a screen's reads arrived one at a time.

  Linear, which feels instant, keeps a replica of the workspace in the
  browser and reads it synchronously, because its data is across a network.
  Ours isn't. And the runtime already has the server's half of a sync
  engine: a change feed with cursors, a watch that resumes from one, and
  reads that say where the feed stood.
- **Decision:** within the data layer of
  [ADR-010](010-desktop-app-mvvm.md):
  - **The window keeps what it read,** in one cache for its life (TanStack
    Query, in `data/`), each read by a key: the projects, the agents, the
    home, a board, a thread, a project's coordinator, rules, connections.
    View models read from it, so a screen shows what was read before at
    once.
  - **Reads go out of date by change, never by age.** The window watches the
    change feed once, for every screen.
    - A change reads again the whole reads it touches (the projects, the
      home, a board, the connections), gathered briefly, whether they are on
      screen or not, so wherever the person goes next is already right.
    - A change to a thread only marks it out of date. The screen showing it
      reads what changed, item by item, as before. A thread not on screen is
      read when it is next opened.
    - A read that was under way when a change touched it is read once more.
  - **A screen reads what it shows before it shows.** Each route's loader
    waits for its reads, from the cache when nothing changed, so a screen
    opens whole. The screen being left stays until then.
  - **A slow read shows the shape of what is coming.** Only a read longer
    than 150 ms shows the place's outline (its bar and skeleton lines, from
    the kit), kept at least 300 ms so it doesn't flash. A screen never shows
    a spinner, and never draws what it hasn't read as empty.
  - **The window opens behind its launch.** While the launch plays, the
    window connects, reads the place it opens on and every open tab, then
    opens onto them.
  - **Reads stay cheap.** What the home, the board and a thread read from
    git is kept per worktree, read again only when the worktree moves, so
    a read is the store's.
- **Alternatives considered:**
  - A replica of the store in the window, as Linear has, with every read
    synchronous and the runtime pushing changed rows. It would make even
    first visits to a thread instant, and writes could show before the
    runtime has them. But it means a second copy of the domain in the
    window, the cards and phases worked out twice, and patching instead of
    reading again. For a runtime on the same machine it adds little over
    the cache.
  - A cache with no waiting (stale-while-revalidate on every screen): fast,
    but a screen that has changed shows its old state and then jumps.
  - Keeping every open tab's screen mounted and hidden (React's
    `<Activity>`): instant tab switching that keeps scroll positions and
    drafts, but it does nothing for the home, for a task opened from
    elsewhere, or for a first visit. It can come on top of this.
  - The runtime pushing whole snapshots instead of the window reading again:
    not needed while reads are this cheap.
- **Trade-off:**
  - The cache is a second copy of what the runtime said. It is never
    patched, only read again or marked, and the feed ends it.
  - Whole reads of screens not on show are read again as things change: more
    reads than strictly needed, kept cheap by keeping git out of them.
  - Waiting for a changed read puts its time, usually a frame, before the
    click shows anything.
- **Revisit when:** the runtime runs anywhere but on this machine, so reads
  cross a network; or reads of threads grow slow enough that opening one
  shows its outline often.
