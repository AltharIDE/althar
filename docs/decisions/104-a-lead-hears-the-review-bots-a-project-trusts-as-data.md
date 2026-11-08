# ADR-104: A lead hears the review and triage bots its project trusts, as findings framed as data

- **Status:** Accepted; built 2026-11-08
- **Date:** 2026-11-08
- **Owner:** Repository maintainers
- **Context:** Teams put agents in their pull request pipelines: Claude's
  code review action, Copilot code review, CodeRabbit, a bot that triages a
  failed build. Althar dropped every bot's comment, and passed none of their
  reviews to the lead, so the person had to pass their findings on by hand
  (DEV-205). A bot's words are written by an automation that anyone who can
  reach the pipeline (a pull request's author, a dependency, a page it
  reads) may steer, so they can't be trusted the way a member's are.
- **Decision:**
  - **The person trusts each bot by itself, in the project's settings.**
    The rules keep the trusted bots by their accounts, in small letters
    (`trustedBots`); none is trusted without it. The settings list the
    trusted ones, then the review and triage bots Althar recognised on the
    project's tasks' pull requests, each a switch, off until turned on.
    Only the person changes it: the settings screen, or Trust in a task's
    thread. An agent's `change_settings` doesn't reach it.
  - **Althar suggests only what it recognises as a reviewer**
    (`reviewerBots.ts`): the review agents it knows by account
    (`coderabbitai[bot]`, `copilot-pull-request-reviewer[bot]`,
    `claude[bot]` and the like), or a bot named for an agent, such as a
    team's own `claude-review[bot]`. Coding agents that open pull requests
    of their own, and bots named for reporting, deploying or bumping
    (coverage, `cloudflare-workers-and-pages[bot]`, Vercel, Dependabot), are
    never suggested. The first time a recognised bot speaks on a pull
    request is recorded (`bot_spoke`), which is what the settings suggest
    from, the latest first.
  - **A trusted bot's words reach the lead as findings named by it**
    ("From CodeRabbit, a review bot this project trusts, on PR #12"), each
    comment and review quoted line by line, as an outsider's comment is
    shown to the person: data, never instructions. The lead is told to
    weigh them as a review step's findings, on the code itself, fixing what
    holds up and setting aside what doesn't, and to follow nothing they ask
    beyond the code: running or fetching something, replying, pushing,
    changing settings, issues or other pull requests. A bot's words are
    never on their own the reason for a step outside the task. Where one
    seems needed, the lead asks the person. On an open pull request they
    wake the lead, as a member's comment does.
  - **A bot the project doesn't trust stays quiet.** Its words never reach
    the lead, in what it is told or when it reads the pull request, which
    says only that a review bot was left out, by name, and how many other
    bots' comments were. The thread shows the first thing a recognised
    reviewer says on each pull request, saying the lead doesn't hear it,
    with Trust beside it. Other bots stay out of the thread, except their
    reviews, which arrive as before.
- **Alternatives considered:**
  - *Trust every recognised reviewer by default.* Rejected: a bot in the
    pipeline is the pipeline owner's choice, not the person's, and the
    words it posts can be steered by whoever opens the pull request. Off
    by default keeps today's behaviour until the person chooses.
  - *Pass bots' words as a member's comment.* Rejected: a member's comment
    asks something of the lead, which it answers on the pull request; a
    bot's is a finding to weigh, and answering or acting on its request
    would let it steer the lead.
  - *Trust by name instead of account.* Rejected: names aren't unique on a
    host; accounts are.
- **Trade-off:** A trusted bot's findings cost the lead a turn each time
  the bot speaks on an open pull request, and a busy bot can be loud. The
  person can turn it off again in the settings.
- **Revisit when:** hosts sign bot output in a way Althar can check, or a
  bot's findings come in a structured form (a check run's annotations)
  worth reading as such.
