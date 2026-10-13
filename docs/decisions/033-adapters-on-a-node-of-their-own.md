# ADR-033: The agent adapters run on a Node the app ships, and Althar's binary never runs as Node

- **Status:** Accepted
- **Date:** 2026-10-12
- **Owner:** Repository maintainers
- **Context:** The bundled adapters, claude-agent-acp and codex-acp, are
  JavaScript. Until now the runtime started them on Althar's own binary as
  Node (`ELECTRON_RUN_AS_NODE=1`; in the packaged app, on Althar Helper).
  That kept Electron's `runAsNode` fuse on, so any process on the Mac could
  run Althar's signed binary as Node, under Althar's identity, with its
  entitlements and the permissions the person gave Althar, such as the
  microphone. ADR-024 left the fuse on, and one entitlements file for every
  helper, until this was settled (DEV-68). The open questions leaned towards
  shipping a Node; the issue leaned towards Electron's utility processes,
  which run Node code in a child without the fuse and add nothing to the
  download.

  A spike on Electron 44.5.0 forked a utility process from the main process,
  since only the main process can fork one, and the runtime is itself a
  utility process. It showed that a utility process can't keep what the
  runtime relies on for a process it owns (docs/architecture/02, 07):
  - It joins Althar's own process group (the child's pgid was the main
    process's), and can't lead one. Node has no `setsid`, and `fork` has no
    `detached`. `process.kill(-pid)` failed with `ESRCH`, and signalling the
    group it does sit in would signal Althar.
  - A `sleep 30` the child started outlived the child and the app, and
    nothing could find it by group after. That breaks the staged stop, the
    survivors report, and cleaning up after an earlier launch.
  - Its stdin can't be a pipe ("stdin value other than ignore is not
    supported"), so ACP would have to be relayed from the runtime, through
    main, to a stdin faked inside the adapter. Its `exit` gives a code,
    never a signal.

  Keeping those guarantees would mean patching the adapters: replacing
  `process.stdin`, and `child_process` so everything they start is detached
  and its group reported back. That patch would have to keep working
  through every adapter release.
- **Decision:**
  - **The packaged app ships Node,** the official build from nodejs.org, at
    the version of Electron's own Node (24.21.0 for Electron 44), so the
    adapters run on the Node that dev and CI run them on. It sits at
    `Contents/Resources/node/bin/node` (`resources/node/bin/node` on Linux),
    with Node's license beside it. `scripts/package.ts` fetches it once,
    checks it against SHA-256 digests kept in `scripts/node.ts` (copied from
    the release's `SHASUMS256.txt`), and refuses an archive that doesn't
    match.
  - **The runtime starts the adapters on it as before:** detached in a
    process group of their own, with the same environment allowlist, raw
    capture, exit code and signal, and pid. The main process names it to the
    runtime in `ALTHAR_NODE` (`adapterNode()` in `process.ts`). In dev and
    the tests there is no such Node, and the adapters run on Electron's
    binary as Node, as they did, with the fuse on there.
  - **The `runAsNode` fuse is off,** with `NODE_OPTIONS` and the inspector's
    flags, which were off already. `ELECTRON_RUN_AS_NODE=1` given to
    Althar's binary starts the app, not Node.
  - **What the adapters start themselves runs on the same Node.** codex-acp
    starts Codex with `spawn(process.execPath, [codex.js, 'app-server'])`,
    which is the shipped Node. The Claude Agent SDK starts Claude Code's
    native binary, not `cli.js`.
  - **Codex's sign-in, status and version run Codex's native binary**
    where the person has no Codex of their own, not `bin/codex.js`. That
    script needs a `node` on the PATH, which an app opened from the Finder
    doesn't have.
  - **Each executable is signed with only what it needs,** through a
    signing function wrapping electron-builder's (`scripts/entitlements.ts`).
    What the agents' binaries get comes from what their makers sign them
    with, less what Althar never uses:

    | Executable | Entitlements |
    | --- | --- |
    | Althar | JIT, microphone |
    | Althar Helper (utility processes: the runtime, dictation, the audio service) | JIT, microphone |
    | Althar Helper (Renderer), (GPU), (Plugin) | JIT |
    | `node` | JIT |
    | Claude Code (`claude`) | JIT, unsigned executable memory, any library |
    | Codex, and its code-mode host | JIT, unsigned executable memory |
    | Everything else: ShipIt, crashpad, `rg`, `zsh`, Codex's voice host, the speech engine's libraries | none |

    Node's own build also allows debugging, `DYLD_` variables and any
    library. The adapters need none of these, so the shipped Node doesn't
    get them. An app signed ad hoc gives Electron's own binaries "any
    library" too, as there is no team for library validation to match.
- **Alternatives considered:**
  - **A utility process per adapter,** forked by main for the runtime. It
    adds nothing to the download, but the spike shows it can't keep the
    guarantees above without patching third-party code. See **Context**.
  - **Keeping the fuse on.** It leaves any process able to run code as
    Althar.
  - **The person's own Node.** It may be missing or the wrong version, and
    an app opened from the Finder doesn't see the PATH where it is.
  - **The adapters compiled to single executables** (Node's SEA, or `bun
    build --compile`). A SEA is a copy of Node with the script inside, so it
    is the same size again for each adapter. Bun is a different runtime
    from the one the adapters are tested on.
- **Trade-off:**
  - **Size.** The app is about 120 MB larger unpacked (Node's binary), and
    about 40 MB larger to download (the zip and the dmg compress it).
  - **One more runtime to keep patched.** A Node security release means
    raising `NODE_VERSION` and its digests in `scripts/node.ts`. Raising
    Electron means raising Node to Electron's Node version.
  - **The shipped Node is signed as Althar's,** so anything that runs it
    runs Node under Althar's team. It gets only JIT, so it can't use the
    microphone or load a library Althar didn't sign. macOS counts
    folder-access permissions to the app responsible for a process: Althar,
    when its runtime starts the adapters, and whatever starts `node` when
    something else does. Claude Code's and Codex's binaries in the app are
    already signed the same way, and run whatever commands they are given.
  - **Codex's adapter** keeps a Node process between it and Codex
    (`codex.js`), as it did on Electron's binary.
  - **Linux packages** get the same Node and fuse change, but haven't been
    run there yet.
- **Revisit when:** Electron's utility processes can lead a process group
  and take a piped stdin; the adapters ship as native binaries; or a Node
  security release lands (raise `NODE_VERSION`).
