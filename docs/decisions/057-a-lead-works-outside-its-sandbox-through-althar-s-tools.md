# ADR-057: A lead works outside its sandbox through Althar's tools, not around it

- **Status:** Accepted
- **Date:** 2026-10-21
- **Amended:** 2026-10-29 ([ADR-071](071-the-sandbox-is-the-boundary-anything-inside-it-runs.md)): where a lead's sandbox can start, its session doesn't start without it, and what it holds runs without Althar reading it; what crosses meets the rules, and git's guard stops what can't be undone.
- **Owner:** Repository maintainers
- **Context:** A lead's agent works in its sandbox (ADR-007, ADR-043): it
  writes only in its worktree, and much of what a lead needs fails there. A
  study of a week of Althar's own agents (Oct 11–19) found leads and
  prototypes stepping outside the sandbox 2,155 times: reinstalling after a
  `.git/config` lock or an npm cache error (29 and 7 sessions, and one task
  stuck at its review limit), starting servers (107 times outside the
  sandbox), and starting Chromium for a screenshot, which fails in the sandbox
  on its Mach port. The rules let those through, after a failed first try
  each. The coordinator, which runs nothing, couldn't take a screenshot at
  all, and no lead could run a flaky check again: `gh` is signed out for
  agents (ADR-011).
- **Decision:** Althar does these itself, outside any sandbox, as tools, so
  the lead asks rather than steps out:
  - **`install_dependencies` (leads)** runs the worktree's setup again as it
    ran when the worktree was made (ADR-023): the setup kept for the
    repository, else the install its lockfile names. Only that: never a
    command the lead gives. The thread shows it, the workspace keeps how it
    went, and the lead reads the end of what it printed either way.
  - **`run_project` and `stop_project` (leads)** run the project in the
    lead's own worktree, its default or one of its runnables by name
    (ADR-044), as the same run the person starts: its card in the task's
    thread, and the Running pill, where the person opens or stops it. A lead
    stops only its task's runs. The coordinator's `run_project` is unchanged.
  - **`screenshot` (leads and the coordinator)** has the desktop app's main
    process draw a page offscreen, in a session of its own that keeps and
    grants nothing, and gives it back to the agent as a picture, at 1×: the
    viewport asked (1280×800 without), the whole page (cut at 16,000 pixels)
    or one element by a CSS selector. Only a page served on this computer, on
    a loopback address or where one of Althar's runs answers, over http;
    never one on the internet, which would be a way out of the sandbox. The
    window holds the page there: a redirect or the page's own navigation
    anywhere else ends the shot with where it went, and a frame that would
    go elsewhere stays empty. Where
    nothing draws pages, as on the command line, the tool says so.
  - **`rerun_check` (leads)** runs checks again on the task's own pull
    request: the one named, or each that failed. Its outcome is heard as
    Althar's own run again is (ADR-041), each time apart, so a failure again
    reaches the lead. GitHub runs an Actions job again, GitLab a pipeline's
    job; a check another service reports to GitHub (Cloudflare's builds,
    Vercel), and every Bitbucket check, can't run again from Althar, and the
    lead is told so, with the check's page for the person.
  - A review's lead gets none of these: it runs nothing of someone else's
    code (Reviews.ts guards a review's tools).
- **Alternatives considered:**
  - **Let the commands through the sandbox from the start** (Claude Code's
    `excludedCommands`). Planned on its own, for commands the project runs
    anyway; it doesn't give the coordinator a screenshot, the person a pill
    for a lead's server, or anyone a rerun.
  - **A screenshot through Playwright in the agent's own environment.** It
    needs Chromium in every worktree and fails in the sandbox as before; the
    app has Chromium already.
  - **A screenshot of any address.** Simple, but Althar would fetch for the
    agent what its sandbox keeps it from.
- **Consequences:**
  - A lead's setup, servers and screenshots run as Althar's, recorded as its
    own processes, which stop when Althar quits; a server a lead forgets runs
    until it or the person stops it, as one the person started does.
  - Tool answers may carry a picture beside their words (`ToolServer.ts`).
  - The runtime asks the main process for a screenshot as it asks it to seal
    a secret: by message, answered within a minute.
