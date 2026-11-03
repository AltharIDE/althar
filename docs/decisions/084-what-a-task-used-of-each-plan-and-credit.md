# ADR-084: What a task used is said per plan and per credit, as the share of a week or dollars, with no total

- **Status:** Accepted
- **Date:** 2026-11-03
- **Owner:** Repository maintainers
- **Context:** People asked what a session cost. Agents report each turn's
  tokens over ACP, and some report what a session cost in dollars
  (`usage_update`). Althar kept the tokens on each turn and the context's
  fullness on each session, but not the cost, and it kept only the latest
  reading of each plan's limits (ADR-062's plan usage). Prototypes offered a
  session panel grown from the context ring, a stats popover in the task's
  menu, and a receipt in Outputs. Each had a breakdown per step, per model and
  per round. The person turned them down as clutter: what they want to know
  is how much of each subscription the task took, and how much of each top-up
  it spent. A total cost means nothing when a share of a week and dollars are
  added together.
- **Decision:**
  - **One line per account the conversation's agents ran on.** It shows the
    account as the plan gauge names it (Claude Code Max, or Codex · Work
    where the agent has several), the models and their tokens under it, and
    its figure at the end, bold and centred. On a plan the figure is the share
    of its week (8% of week). Paid per use, it is dollars. There is no total,
    nothing per step or round, and no figure for what is left: the plan gauge
    already says that.
  - **A task's line covers every thread of the task,** its reviews' included,
    across handovers. The coordinator's covers its own conversation since
    this computer's midnight.
  - **It shows in two places.** The composer's context ring shows the lines
    under the context, headed "This task so far" or "Today". In a task's
    Outputs it is a Usage card under the pull request: one row of figures
    that opens to the lines. The card is closed by default, and once the
    person opens or closes it, every task follows (`althar.usage`).
  - **The share of a week is an estimate.** Each time an account's week
    moves, Althar keeps the reading (`plan_usage_weeks`). The rise between
    two readings is shared among the turns that ran on the account between
    them, by their tokens, so a task's turns get their part beside other
    tasks'. Where two readings are more than 30 minutes apart, only the part
    of that time the turns ran in counts, because the rest may be use outside
    Althar. A week that stands still keeps the reading where it began and its
    latest one, so a task after a quiet stretch has a reading from just
    before it. The figure reads as an estimate: "~8% of week".
  - **Dollars are what the agent said,** kept on the session
    (`provider_sessions.reported_cost`). Where it said nothing, Althar prices
    the turns' tokens at the model's list prices, and prices a cache read
    where the list says; those dollars read as an estimate too, "~$1.24".
    One session that neither said nor has a price leaves the account's
    dollars a dash, wherever it falls among the others.
- **Consequences:** A reading that fails leaves the usage out of the
  snapshot, never the thread. Tasks that ran before migration 0056 have no
  readings of a week, so their share shows as a dash. A plan whose week Althar
  can't read shows a dash the same way.
