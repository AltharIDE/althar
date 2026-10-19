# ADR-046: Errors and crashes go to PostHog's error tracking from the main process, masked, behind a switch of their own

- **Status:** Accepted; what was caught and carried on past, and agents that stop, reported too since [ADR-047](047-failures-kept-where-they-belong-and-reported-at-the-edge.md)
- **Date:** 2026-10-17
- **Owner:** Repository maintainers
- **Context:** Report a problem (ADR-045) needs the person to notice and
  write in, and at launch most won't (Linear DEV-66). A crash in the
  runtime's utility process, an uncaught error in the window, a page that
  dies or a native crash should reach the team without anyone writing in,
  tagged with the build it came from. Errors carry what usage data
  (ADR-036) never may: messages and stacks, which can name the person's
  folders, projects and repositories, and, from a library or an agent,
  a token. The ticket leaned to Sentry, which takes Electron's minidumps.
  The team already has PostHog, for usage data, and its error tracking
  takes `$exception` events from posthog-node.
- **Decision:**
  - **PostHog's error tracking, from the main process alone**
    (`main/crashReports.ts`), with posthog-node's `captureExceptionImmediate`,
    under usage data's project key and host, over Electron's own network.
    The window and the runtime never send: the window's uncaught errors and
    rejections already come to main for the log (`althar:window-error`), and
    the runtime tells main its own over the parent port (`crash`, from
    `runtime/crashes.ts`), as it tells its nudges and usage. A process that
    stops other than cleanly (`render-process-gone`, `child-process-gone`),
    and the runtime stopping too often to start again, are reported as
    exceptions of their own, with why and the exit code. Each is watched,
    not handled: what Electron does with them stays as it was.
  - **Native minidumps stay on this computer.** Crashpad is started early
    in main with uploads off (`crashReporter.start({ uploadToServer: false })`),
    so a native crash in any process leaves a minidump in Electron's crash
    dumps folder (in the window's data folder). On the next launch main
    sends, for each one it hasn't seen, one `Native crash` exception: which
    process (from Crashpad's `ptype` annotation) and when. Never the dump.
    Each dump there is remembered as seen in `desktop.json` whether or not
    reports are on, so turning them on never reports a crash from before.
  - **Masked before anything leaves, in `before_send`.** Every string in
    the exception list (type, message, each frame's file and function) goes
    through Report a problem's masker (`logs/mask.ts`): paths under the
    home folder, the projects' and repositories' names (asked of the
    runtime, which holds the store, as last learned), who the person is on
    this computer, emails, and anything shaped like a key or token. A frame
    keeps only its place (file, function, line, column, whether it is
    Althar's own); the lines of source PostHog's client reads round it and
    any variables are dropped, and a stack PostHog made up where the error
    was caught, rather than where it was thrown, isn't sent. An event keeps
    only the exceptions, their level, the process (`main`, `window`,
    `runtime`, `gpu`, `utility`, `unknown`), the app's version as
    `$app_version` and `release`, the system and the processor. A message
    is cut at 1,000 characters, a chain at five exceptions, a stack at 50
    frames. A report that can't be masked never goes.
  - **Their own switch, on by default, asked once on the first screen.**
    "Crash reports" is an app preference (`crashReports`) beside Usage data
    in Settings' About Althar, with one line on what they carry and never
    carry; the first screen carries one quiet line with the same switch at
    its sheet's foot, never a dialog or a step to finish. Off means no
    client is made and nothing is asked of the network; every request asks
    the switch again as it goes. `DO_NOT_TRACK` keeps it off and locked, and
    a `desktop.json` that can't be read keeps it off, as usage data.
  - **Anonymous, and little.** The install's random id (ADR-036), no person
    profile, no GeoIP. At most 20 reports a launch, and the same one
    (its type and where in Althar it was thrown, or what it says where it
    has no stack) once a launch. One that can't go is dropped; reporting
    never throws into what failed, and quitting waits for reports on their
    way a few seconds at most, with usage data.
  - **Only a release sends**, as usage data: development builds, the
    end-to-end tests (which give a PostHog of their own) and forks send
    nothing.
- **Alternatives considered:**
  - **Sentry**, as the ticket leaned. It symbolicates Electron's native
    minidumps and its Electron SDK covers every process. It is a second
    vendor and SDK for one need, whose Electron SDK hooks the window and
    would want the window's policy opened to it, and the masking would have
    to be kept twice. Native crashes are rare next to JavaScript errors in
    an app that is mostly JavaScript.
  - **Uploading minidumps** (Crashpad's own uploader, or to PostHog as an
    attachment). A minidump holds the crashed process's stack memory, which
    can hold anything the process held: what was typed, a token. It can't
    be masked as text can.
  - **posthog-node's own exception autocapture**
    (`enableExceptionAutocapture`). It handles uncaught exceptions itself,
    calling `process.exit(1)` after a fatal one, which would change how the
    main process behaves; and it sends before Althar can choose.
  - **Errors as usage data events.** Usage data is named events with
    properties from fixed lists; an error's message and stack are free
    text, and need masking, not a list.
  - **One switch for both.** Usage data and crash reports carry different
    things; people may want one and not the other (ADR-036 said so).
- **Trade-off:**
  - **The window's stacks name minified code** until source maps reach
    PostHog. Every bundle is built with source maps (`sourcemap: true` in
    `vite.config.ts` and `vite.node.config.ts`), and packaging leaves them
    out of the app. Main's and the runtime's bundles aren't minified (an SSR
    build), so their stacks read by function name and the bundle's line
    without maps; the window's are minified and read as `index-….js:1:2345`.
    Uploading the maps in the release workflow (posthog-cli, with a key that
    can write them) is not done yet.
  - **A native crash says which process, not why.** Its dump stays on the
    person's computer and nothing symbolicates it. The launch it happens in
    also reports the process that stopped, so a native crash is said twice.
  - **Masking can miss a name the runtime hasn't said**, as when it stops
    before main learned them; paths keep only their last part, and tokens
    are matched by shape.
  - **Twenty a launch** loses the 21st distinct error of a bad launch; the
    same one once a launch counts how many launches hit it, not how often.
  - **An agent adapter that dies is not reported yet.** The runtime records
    it on the turn (`errorClass: 'agent_exited'`, in `Sessions`), in more
    than one place, and nothing tells main of it; the turn's record is what
    Report a problem sends.
- **Revisit when:**
  - Native crashes matter: Sentry, or symbolicating minidumps, with a
    consent of their own for what a dump holds.
  - Source maps are uploaded in the release workflow (DEV-62).
  - The first public launch in the EU: whether crash reports on by default
    need an explicit yes, as usage data may.
