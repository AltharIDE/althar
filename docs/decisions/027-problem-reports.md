# ADR-027: Problems are reported from the app, masked, through a Worker that makes Linear issues

- **Status:** Accepted
- **Date:** 2026-10-11
- **Owner:** Repository maintainers
- **Context:** The first builds go to friends and family (DEV-61). When a
  tester says "it just stopped", there was nothing to look at: the main
  process, the runtime and the agents' adapters wrote nothing to disk, and a
  packaged app's stdout and stderr go nowhere. Asking testers to open an
  issue on GitHub, attach logs they can't find and describe their setup
  loses most reports. The team triages in Linear. Logs and screenshots are
  private: they name the person's folders, projects and repositories, and an
  agent's stderr can carry anything.
- **Decision:**
  - **Logs on disk, quiet, per process kind.** `main.log`, `runtime.log` and
    `agents.log`, where the system keeps an app's logs, each turned over by
    size and kept about a week. Lifecycle, errors, and each turn's start and
    end by their ids; never prompts, messages or file contents. Each file
    has one writer.
  - **One dialog, in the app.** Report a problem opens from Help, the foot
    of Settings, and Report this on what went wrong, carrying its task. One
    box is required; the screenshot and the logs are on and can be switched
    off; See what's sent lists every item; an email is optional and
    remembered. No categories: triage sorts bugs from ideas.
  - **Masked before it leaves.** Paths under the home folder lose their
    folders, project and repository names become stand-ins, the person's
    name, the computer's and email addresses go, and anything shaped like a
    key or token is removed, though Althar collects none.
  - **A Worker holds the key.** The app posts the report to a small
    Cloudflare Worker (`apps/report`), which validates it, caps its size,
    rate-limits per install and per address, and creates an issue in the
    Development team's Triage, labelled "From the app", with the screenshot
    and logs uploaded to Linear. The app never holds a Linear key.
  - **Mail when there is no Worker.** A build without the Worker's address
    saves the report as a zip in Downloads and opens a message to send it
    with.
  - **An install id, random, kept in the profile,** so a report can be
    matched with later crash reports and analytics without saying who sent
    it.
- **Alternatives considered:**
  - Linear's API key in the app: anyone could take it from the bundle.
  - GitHub issues from the app: public by default, and logs don't belong
    there; the team triages in Linear.
  - Sentry or a crash service alone: catches crashes, not "it just stopped",
    and the tester's words are what explain a silent turn.
  - Linear's email intake as the only path: no size or rate control, and no
    structured facts.
- **Trade-off:** A Worker is one more thing to deploy and keep a secret for,
  and its endpoint is public: anyone with the address can post, within the
  rate limits. Masking by pattern can miss a name the store doesn't know, or
  hide a word that only looks like one.
- **Revisit when:** reports arrive from people the team doesn't know (a
  daily cap per install, or a signed request, would be needed); crash
  reporting lands and can share the path; or Linear's Triage stops being
  where the team starts.
