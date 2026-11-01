# ADR-078: Project leads can read the web

- **Status:** Accepted
- **Date:** 2026-10-31
- **Owner:** Repository maintainers
- **Context:** Leads need documentation, changelogs, public issues and competitors’
  pages to do their work. Asking for each website interrupts it. This follows
  the permissive direction in the project’s notes of 29 October.
- **Decision:**
  - “Leads can reach the web” (`leadsReachWeb`) is a project switch, on by
    default, in Settings → General. Implementers and the project’s own
    reviewers get Claude Code’s WebSearch/WebFetch, Codex’s live web_search
    (including opening pages), and OpenCode’s websearch/webfetch without
    permission requests reaching Althar or the person. It applies when a new
    session starts; restart an existing session after changing it.
  - Outside pull request reviews remain offline (ADR-058), whatever the
    switch says. Codex remains ineligible to lead those reviews. The
    coordinator keeps its existing settings.
  - Shell network controls stay as they were. Codex’s workspace-write
    network_access switch is all or nothing; we choose off. Claude’s domain
    allowlist cannot distinguish GET from POST; we keep the known hosts,
    rather than opening every host. OpenCode has no shell sandbox.
    Opening either sandbox network broadly would also let uploads bypass
    the rules. Instead the rules allow plain HTTP(S) curl/wget reads to
    stdout while the switch is on, even where the rest asks. Use
    `curl -q -fsSL https://example.com` or
    `wget --no-config --no-netrc --no-hsts -qO- https://example.com`: local config must not turn
    the read into an upload. Compound commands, scripts, custom headers,
    output files, method changes and uploads still meet the existing rules.
    A sandbox’s host-only request cannot prove a GET, so it gets no blanket
    approval: use the native web tools, or a plain command requesting the
    network permission it needs.
  - Off, native fetches ask as before, searches are explicitly gated
    (disabled for Codex), and the shell rules give no new read exemption.
    Credential denials, writes, posts and irreversible operations retain
    their existing rules. Explicit shell command rules still win.
- **Trade-off:** A lead that reads a private repository and can fetch arbitrary
  URLs could be steered by a page into leaking code in a URL, including a
  search query. Read-only HTTP is not a defence against that. The project
  switch and offline outside reviews are the mitigation. The switch is for
  repositories where code must not leave through a URL; it is not an
  air gap, and does not remove the pre-existing known-host permissions.
- **Validation:** Focused adapter tests exercise each provider’s on, off and
  offline settings; runtime rules tests cover reads, uploads, command rules
  and outside reviewers. The desktop setting is checked through its client
  and in the running app. Real provider probes are separate from those tests.
