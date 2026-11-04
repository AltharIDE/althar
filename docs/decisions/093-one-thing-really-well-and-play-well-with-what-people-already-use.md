# ADR-093: Althar does one thing really well, and plays well with what people already use

- **Status:** Accepted
- **Date:** 2026-11-04
- **Owner:** Repository maintainers
- **Context:** Anthropic's [AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)
  lays out a whole lifecycle: intent and spec files, plan mode, skills and
  hooks, evals in CI, AI review, approval gates, agents in the pipeline,
  deploys tiered by environment, monitoring bands, security scans and an
  agent on call. Mapped against Althar, the middle is strong (a worktree per
  task, agents in parallel, rules every agent is held to, Verify, green
  before it reaches the person, review drafts the person posts). The ends
  are thin. Each gap could become a system of Althar's own: an intent and
  spec store, a metrics view, an eval runner, a CI step, a deploy gate.
  The thesis asks what Althar should not own (§12.12) but doesn't answer
  it. Without an answer, every gap reads as a feature to build, and Althar
  becomes a worse copy of tools people already have.
- **Decision:**
  - **The one thing.** Take a piece of work through the agents the person
    already pays for, to a change they can trust and merge, pulling them in
    only when it matters. Work that makes that better comes first: a change
    that is right, proved, and says what stands between it and the merge.
  - **The merge is the edge.** Althar takes work to a change the person can
    accept. Deploys, environments, release gates, monitoring and on-call are
    other tools' work. Althar stops at the merge, which stays the person's.
  - **Their tools are the record.** What a team already keeps somewhere
    stays there: issues and requirements on their tracker, conventions and
    review rules in their repository, checks in their CI, required reviews
    and branch rules on their code host. Althar reads them, writes to them
    through its connectors when the person says, and keeps a link, not a
    copy of its own.
  - **What they already run is heard, not replaced.** Their review bots,
    their CI agents, their `CODEOWNERS` and branch protection, their
    instruction files. Althar works with each of these rather than bringing
    its own version, and never races or overrides one.
  - **Useful to one person on a team that has never heard of Althar.**
    Nothing may need the whole team or org to adopt it first. What Althar
    posts reads as the person's own work, in the team's own places.
  - **A test for new work.** Before building something, ask: does it make
    the one thing better, or does it let Althar work with something the
    person already uses? If neither, it waits. If a tool they likely have
    already does it, Althar connects to that tool instead.
- **What it means for work already raised:**
  - First: DEV-204 (what the host needs before a merge, ticked off), DEV-198
    (a plan of the change that Verify checks the diff against), DEV-199 (a
    fix starts from a failing test), DEV-201 (new work waits while too much
    needs the person).
  - Then, playing well: DEV-205 (hear the review bots they trust), DEV-206
    (don't race their CI agent), DEV-203 (intent kept on their tracker or in
    their repository, not in a store of Althar's).
  - Waits: DEV-197 (evals), DEV-202 (automations on signals). DEV-200 shrinks
    from a metrics view to one line on the change. Althar as a pipeline step
    (DEV-130, DEV-125) is not a CI product.
- **Alternatives considered:**
  - Cover the lifecycle end to end, as the playbook does with Claude's own
    products: a second product for each stage, each worse than the tool the
    team already has, and each one only Althar can read.
  - An Althar-native artifact chain (intent, spec, plan, review files) for
    every task: ceremony that doesn't fit a quick task, and a format no
    other tool reads.
  - Stay a better agent chat with no connectors: leaves the person moving
    things between tools by hand, which is where the time goes.
- **Trade-off:** some things a team wants, Althar won't do, and it says so
  rather than half-doing them. Work against other tools costs connectors and
  their upkeep (ADR-011), across every code host and tracker. Leaving the
  record in other tools means Althar's own picture is only as good as what
  it can read.
- **Revisit when:** the one thing is excellent and people ask for the next
  stage; a stage has no tool people already use; or the project-level
  boundary of the thesis gives way to a wider one (thesis §4) that needs
  state no existing tool keeps.
