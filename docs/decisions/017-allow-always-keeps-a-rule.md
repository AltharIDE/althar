# ADR-017: Allow always keeps a rule in the project

- **Status:** Accepted
- **Date:** 2026-10-10
- **Owner:** Repository maintainers
- **Context:** A permission call offered only Allow once and Deny. An agent
  that runs a command the person is happy with asked again the next time,
  so a long run kept stopping on the same thing, worst of all under "Ask
  me", where `bun test` asked every time. The project's rules
  ([ADR-013](013-project-rules.md)) held an always-ask list and a never list,
  so an "always" had nowhere to go, and ADR-013 had set an allowlist aside
  as something that "could serve the `ask` mode later". The kit already had
  Allow always and Deny always with a scope, and a stack of calls with
  "Allow all". Agents offer `allow_always` themselves, but Althar never sends
  it ([ADR-007](007-permission-requests-reach-althar.md)): the agent would keep
  the rule and stop asking.
- **Decision:**
  - **The project's rules hold allow rules,** beside what always asks and
    what is never allowed, in the same shape:
    - kinds always allowed (`alwaysAllow`), the same kinds the other two
      lists name;
    - command rules with the decision `allow`, by how a command starts as
      before (`git status`), or with `match: 'exact'`, the whole line as it
      was. An exact rule can ask or refuse too.
  - **Precedence, in order:** what no project can change; what is never
    allowed; allowing everything; what always asks (a kind on the list, or a
    command the project asks about), which is *held* for the person; then
    what would otherwise ask (what the rules can't tell, or, under "Ask me",
    anything beyond the task's own files) is let through where the allow
    rules cover it; the rest asks. A never and an always ask beat an allow
    rule, always. The lead deciding (DEV-22) comes after the allow rules and
    before the person, and answers only what isn't held: a verdict that asks
    says whether it is held.
  - **What a rule covers:** an exact rule, the line. Otherwise each command
    of the line that would ask must start as an allow rule says (as itself,
    or as what a package runner or a shell runs for it), or be only of kinds
    always allowed. A command that only changes folder or only looks (the
    reader rules' list) rides along with the rest, so `bun test 2>&1 | tail`
    is covered by `bun test`; it never makes a rule of its own. A line whose
    commands only show when it runs (`$(…)`, `eval`) is never covered.
  - **A call offers only an always that would hold.** As it asks, the runtime
    works out what an always would keep (the exact command, how its command
    starts, the kind it is) and, by trying each against the rules, which
    scopes Allow always and Deny always would hold by. Something held for the
    person offers no Allow always: the always-ask list would win next time.
    The call carries this; the answer names only the scope, and the runtime
    keeps the rule it offered, nothing the window sends.
  - **Allow always writes an allow rule; Deny always writes to the never
    list** (a never command rule, or the kind on the never list), as a
    revision of the rules recorded as the person's, in the same transaction as
    their answer. The agent is still sent its narrowest option.
  - **The rules decide again what still waits** when they change, from an
    answer or the rules screen: a call they no longer keep for the person is
    answered by them, so the other cards of a stack an Allow always covers go.
  - **The record says which rule answered:** the decision keeps the allow
    rules that let a request through (`decisions.rule`) and the revision they
    are in (`decisions.policy_id`); the person's always answer keeps the rule
    it saved in its fact. A tool call in the thread says the first, as an
    "allowed by" receipt.
  - **Allow all allows each card in the stack once,** the always-ask ones
    too: each was kept for the person, who sees the count. It keeps no rule.
- **Alternatives considered:**
  - **Allow always beating the always-ask list,** as the prototype's home
    card offered for `npm publish`. It would turn a card into a way around
    the list the person keeps for themselves.
  - **Allow always by kind taking the kind off the always-ask list.** The
    same loosening, from a card; the rules screen is where that list changes.
  - **A separate allowlist beside the command rules.** Two lists with the
    same matching; the one list with a decision per rule was the open
    question's leaning.
  - **The window sending the rule to keep.** It would let any client write
    any rule through an answer; the runtime keeps only what it offered.
  - **Matching the whole line by its start.** `git status && curl … | sh`
    would pass a `git status` rule; tools that matched that way were
    bypassed (ADR-013).
- **Trade-off:** allow rules only see what reaches Althar. A command that
  stays in an agent's sandbox never asks, so a rule for it never fires (the
  sandbox gap, ADR-013). Allow rules mostly matter under "Ask me" and for what
  the rules can't tell; under the default mode nearly everything is allowed
  already. Exact rules keep a whole command, which can hold a secret, as the
  record of the request already does.
- **Revisit when:** the lead answers requests (DEV-22); the project's command
  rules reach the agents in their own forms; rules on paths or the network
  arrive.
