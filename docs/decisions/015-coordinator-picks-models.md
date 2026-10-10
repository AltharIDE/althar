# ADR-015: The coordinator picks models; agents are only ways to them

- **Status:** Accepted
- **Date:** 2026-10-08
- **Owner:** Repository maintainers
- **Context:** People choose who does work by model, not by the tool that
  runs it. Nobody cares that a step runs on OpenCode; they care that it runs
  on GLM-5.3, or Claude Sonnet 5.5. The coordinator was meant to recommend a
  lead model per task ([05](../architecture/05-workflow-engine.md), Lead
  recommendation). The code drifted: its brief listed only the agents by
  name, `propose_plan` took an agent, and a step ran on whatever that agent
  starts on by itself. The coordinator chose blind, by brand. One model is
  often reachable several ways, for example GPT-5.6 Luna through Codex or
  through OpenCode Go, on a plan or on a key. Each agent describes its own
  models in its own words, unevenly: OpenCode says nothing about them, and
  Claude Code and Codex describe only their own.
- **Decision:**
  - **The coordinator picks a model for each step.** `list_models` gives it
    every model Althar can use now, once each, grouped by maker, with what is
    known of each. `propose_plan` names the lead's and the reviewer's model
    as listed. Its brief tells it to pick by what the step needs and not by
    brand: the strongest models for large, risky or open-ended work, a
    quicker one for small, well-scoped work, a plan over a key where they
    would do as well, and a reviewer from a different maker than the lead
    where there is one.
  - **What it can use:** every model of every agent that is signed in and
    not out of usage, except the ones the person switched off. A model
    offered by several agents is listed once. An agent's own default ("Default
    (recommended)") isn't a model of its own; it is the model it stands for.
  - **Agents are routes.** Althar takes a named model the best way there is:
    an agent whose account a plan pays before one on a key, then in the
    agents' order. A plan that names an agent, as plans did before, still
    works, on that agent's model or its own default.
  - **What is known of models comes from OpenRouter's public list:**
    Artificial Analysis's intelligence, coding and agentic indices, price
    per use and context size, matched to each agent's model by its id or by
    its name as people know it. It is read from the profile's copy as the
    runtime starts and fetched again in the background. Nothing waits for
    it; a fetch that fails is logged and otherwise ignored, and a model the
    list doesn't have goes without. The scores are for the coordinator, and
    the window doesn't show them.
  - **The person can switch models off,** per agent, in Settings beside the
    agent's accounts, and from the model browser ("Don't use"). One switched
    off is never planned, and no picker offers it.
  - **The window names who works by model,** as people know it: Claude
    Sonnet 5.5, GPT-6 Astra, GLM-5.3, with its maker's mark. The agent that
    runs it, and the account, show on hover ("via Claude Code · work").
    Agent names stay where they are what is meant: Settings, where accounts
    are signed in.
- **Alternatives considered:**
  - **A default model per agent** ("new work starts on"). It answers a
    question nobody asks, which agent to use, and fights the coordinator's
    choice. It was built and taken out.
  - **The agents' own descriptions as the coordinator's data.** They are
    the makers' own words, uneven, and missing for OpenCode.
  - **Artificial Analysis's API directly.** It wants a key that must stay
    on a server, not in a desktop app. Worth it if Althar ever runs its own.
  - **models.dev.** It knows families and release dates, but has no scores.
- **Trade-off:**
  - **Althar depends on a third party's list.** It is public and keyless,
    but it can change shape or go away; then the coordinator picks from
    names and the agents' own words, as before.
  - **Matching is by name.** A model an agent names in a way the list
    doesn't goes without scores until the matching learns it.
  - **Usage limits still move a step by agent.** When the agent a step runs
    on is out, the step moves to another agent, which may not offer the
    same model.
- **Revisit when:**
  - Althar runs a server of its own: fetch the scores there, from more than
    one source, and keep a history.
  - Past outcomes on similar tasks are recorded: weigh them too, as 05 asks.
  - A usage limit can move a step to the same model on another agent.
