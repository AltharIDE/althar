# ADR-048: The runtime stays in the app and runs headless too, and a client on the local socket can't answer for the person

- **Status:** Proposed
- **Date:** 2026-10-19
- **Owner:** Repository maintainers
- **Context:** ADR-003 put the runtime in a utility process, to revisit "when
  work must outlive the app and a daemon is needed". The command line,
  cloud runners and a phone are coming (DEV-128, DEV-130, DEV-131), and each
  needs the runtime somewhere other than the app's window, or a way to reach
  it from outside. Today:
  - Main forks the runtime and hands it the profile and the app's version in
    its environment (`apps/desktop/src/main/main.ts`, `startRuntime`), then
    a `MessageChannelMain` port for each page load (`connect`). Holding the
    port is the only credential.
  - The host round the runtime is Electron's
    (`apps/desktop/src/runtime/runtime.ts`): it fetches over Electron's `net`
    (`appFetch`), asks main to seal secrets with `safeStorage` (`askMain`;
    `seal` in `main.ts`), and tells main on `parentPort` what needs the
    person (`nudge`, DEV-120). `@althar/runtime` imports nothing from
    Electron; the host hands it secrets and fetch as options to
    `services(...)`.
  - The CLI runs a smaller runtime in its own process (`apps/cli/src/main.ts`,
    `Runtime.layer`), with no secrets (`Secrets.none`,
    `packages/runtime/src/Runtime.ts`). The store holds SQLite in exclusive
    locking mode, so the CLI can't run while the app has the profile open
    (DEV-115).
  - `API_VERSION` comes back from `Status` (`packages/runtime/src/Api.ts`),
    and no client reads it (DEV-117).
  - Quit posts `shutdown`; the runtime stops every session and records it,
    and main kills it after 20 s (`main.ts`, `before-quit`). Nothing asks
    first (DEV-118). Off a Mac, closing the last window quits (DEV-122).
    Nothing opens at login (DEV-124).
  - Agents reach Althar's tools over HTTP on `127.0.0.1`, each session with a
    bearer token of its own that names its role
    (`packages/runtime/src/ToolServer.ts`): a lead gets a lead's tools, never
    the person's.
  - Agents run as the person's OS user, on a trusted host (doc 07). What a
    terminal the person opens can read or run, an agent's command can too.
- **Decision:**
  - **The utility process stays the desktop's host,** as ADR-003 has it.
    `@althar/runtime` stays free of Electron. What a host gives the runtime
    (secrets, fetch, folder grants) and what it does with usage data and
    crashes stay the host's, as in `runtime.ts` now. What needs the person
    moves onto the API, so every client hears it, not only main (DEV-120).
  - **A headless host runs the same runtime on plain Node:** on the
    person's computer, the Node the app ships (ADR-033); on a runner, a
    system Node. It is an app, `apps/host`, built into one file like the
    CLI, and the CLI's in-process mode becomes it (DEV-125). It serves the
    API on the socket only, fetches with Node's `fetch`, sends no usage data
    or crash reports, takes its folders from its configuration, and stops on
    SIGTERM as Quit does.
  - **One runtime per profile, whichever host runs it.** The store's lock
    stays. A client that finds a runtime on the profile attaches to it, and
    never opens the store beside it (DEV-128).
  - **Transports.** The API is one Effect RPC contract over a `PortLike`
    (`packages/contracts/src/transport.ts`). The domain API depends on no
    transport; the windows keep their `MessagePort`s.
    - **Now, a local socket:** a Unix domain socket (a named pipe on
      Windows), with JSON messages, in a folder of the profile that only the
      person can open, removed at quit (DEV-121, DEV-123). A client first
      says which API version it speaks, and is refused with both versions
      named where they differ (DEV-117). Then it shows the per-launch secret
      written beside the socket. The folder keeps other OS users out, and the
      secret keeps out a client of an earlier launch. Neither tells the
      person from their agents.
    - **Later, a relay the runtime dials out to,** over a WebSocket,
      encrypted end to end so the relay carries only what it can't read, for
      a phone (DEV-131). Nothing listens on a network interface, on the
      laptop or anywhere else.
  - **A client on the socket can't answer for the person** (DEV-121's
    narrower role). It can read, start tasks, talk to their leads and stop
    sessions, as the CLI does now. It can't give the person's word: answer a
    permission request or a question (`Answer`, `AnswerQuestion`,
    `AnswerStuck`); push, merge or post
    a review (`Push`, `Merge`, `PostReviewDraft`); or widen what agents may
    do (`SetProjectRules`, `SetTaskAllowEverything`, accounts and
    connections). The contract marks the calls a socket client may make, and
    the runtime refuses the rest by the connection's role, as the tool
    server refuses a lead the coordinator's tools; a new call is refused
    there until it is marked. These stay with the window, and with a
    paired device once answers record who gave them (DEV-126, DEV-132). The
    CLI's `/allow` and `/reject` work in-process, where it holds the store
    alone, and not once it attaches.
  - **A device other than this computer is paired from the window:** a
    phone scans a code in Settings, keeps its own key, and can be unpaired
    (DEV-131). An agent can't read a key that never comes to this computer,
    so a paired phone may answer, once who answered is recorded.
  - **A background app before a daemon.** Work outlives the window, not the
    app:
    - closing the last window leaves Althar working where it has a tray or
      the edge (DEV-122), as it already does on a Mac;
    - "Open Althar when I log in" starts it with only the tray or the edge
      and the runtime (DEV-124);
    - Quit, with work under way, says what it will stop and asks, and offers
      to keep working in the background instead (DEV-118).
  - **A daemon** (a launchd agent, a systemd user service) **becomes worth it
    when one of these is real,** measured rather than foreseen:
    - **Updates interrupt work** people wanted kept. An update restarts the
      whole app, runtime and all (`updates.ts`; `autoInstallOnAppQuit` in
      `updater.ts`). A daemon helps only if it updates apart from the app,
      and its own updates still stop work unless a new runtime can take its
      sessions over.
    - **Electron's memory in the background** is a complaint: with no window
      open, the main process, the GPU process and the edge's pages stay.
    - **Its costs are settled first:** macOS counts privacy permissions
      (folders, the microphone) and notifications to the app responsible for
      a process. A runtime launchd starts is responsible for itself, so the
      person would grant them again under another name, and its
      notifications would come from it or go through the app. The window
      would reach it over the socket, and need a credential agents can't
      read, which the socket doesn't have.
  - **Mobile goes through the relay first.** The laptop stays canonical, and
    the cloud is a pipe that holds no project state. A phone sees Althar
    only while the laptop is awake and Althar runs, and says so when it
    isn't. Cloud authority (doc 07: Postgres ordering revisions, with
    runners) comes when collaboration is real: a project several people
    share, or work that must go on with the laptop shut.
  - **Runners use API keys; work on a subscription stays on the person's
    device** (doc 03, rules 5–8). A runner refuses a subscription account,
    and its keys come from storage on the cloud side, never from the
    laptop's sign-ins (DEV-130). A runner's lease is held where the attempt
    is canonical: on the laptop, while the laptop is (doc 07).
- **Left open, for the person to choose:**
  - **Whether the socket listens by default** (DEV-123). Leaning: off,
    behind a setting, since even in its narrow role it lets any agent read
    every project and start tasks, which its own tools don't. On would make
    the CLI work with no step first.
  - **Whether "Open Althar when I log in" is on by default** (DEV-124).
    Leaning: off, offered once, the first time the person keeps Althar
    working in the background.
  - **Accepting the narrower role over pairing,** and the relay over cloud
    authority, as recommended above.
  - **Not decided here:** how a headless host keeps sign-ins, sharing the
    desktop's sealed ones or keeping its own (DEV-119's spike reports back
    to this ADR); and how a runner claims and leases work (DEV-130's ADR).
- **Alternatives considered:**
  - **Pairing the CLI from the window** (DEV-121's other option): the person
    allows a new client once, and it is known by a key after. It keeps out a
    client nobody allowed, but the key lives where the CLI can read it, as
    the person's user, so a lead can read it too, or simply run the paired
    CLI. Answering is a command like any other, and under allow everything
    (ADR-043) nobody is asked to run it. Pairing can't tell the person from
    their agents on this computer, so it is kept for other devices.
  - **Refusing agents' processes,** by the connecting pid against the
    process groups the runtime owns. Node has no API for a socket's peer
    (it needs a native module), and an agent can leave its group (`setsid`,
    `nohup`, `open -a Terminal`), so it isn't a boundary.
  - **A daemon now.** It costs what is listed above, and a background app
    keeps work past a closed window without it.
  - **Cloud authority first.** A phone would work with the laptop shut, but
    it means a hosted Postgres, sync and migrations before anyone shares a
    project, and the canonical record leaving the person's computer.
  - **The headless host as an entry point in `@althar/runtime`.** The
    package would carry a host's choices (logging, fetch, configuration),
    which apps hold, as `apps/desktop/src/runtime` does.
- **Trade-off:**
  - **The CLI can't answer once it attaches,** and on this computer nothing
    lets it again: nothing tells it from an agent. Answers come from the
    window and from a paired phone.
  - **The socket still gives agents more than their tools do:** every
    project, new tasks, stopping sessions. Hence leaning off by default.
  - **Work stops at quit and while the laptop sleeps,** until a daemon or a
    runner carries it. Keeping the computer awake is a setting already.
  - **The relay is a service to run** beside `apps/report`'s Worker, and an
    encryption protocol to get right.
- **Revisit when:**
  - one of the daemon's conditions above is real;
  - something on this computer could tell the person from an agent (an OS
    prompt for each answer, a hardware key), for answers from the CLI;
  - a project is shared, or work must run with the laptop shut: cloud
    authority;
  - DEV-119 reports how a headless host keeps sign-ins.
