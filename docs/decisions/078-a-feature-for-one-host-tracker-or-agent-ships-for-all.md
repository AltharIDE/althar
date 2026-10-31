# ADR-078: A feature for one code host, tracker or agent ships for every one that can have it

- **Status:** Accepted
- **Date:** 2026-10-31
- **Owner:** Repository maintainers
- **Context:** Althar works with four code hosts (GitHub, GitLab, Bitbucket
  Cloud, Bitbucket Data Center), five trackers (Linear, Jira, Trello, and
  GitHub's and GitLab's issues) and ten agents
  ([doc 03](../architecture/03-agent-runtime-and-auth.md#agents-in-the-mvp)).
  Their models were laid against every service before an adapter was
  written ([doc 06](../architecture/06-integrations-and-skills.md#code-hosts-and-trackers)),
  and an agent joins by a registry entry and the contract suite (ADR-050).
  Since then, features have landed on one service and stayed there:
  - posting a review on a pull request Althar didn't open is GitHub's alone
    (`capabilities.reviews`, `connectors/src/model.ts:276-281`);
  - running a failed check again does nothing on Bitbucket, and answers
    only `false` (`connectors/src/bitbucketCloud.ts:598`,
    `bitbucketDataCenter.ts:634`);
  - only GitHub's merge queue is used, though GitLab has merge trains and
    auto-merge, and Bitbucket has queues and auto-merge of its own;
  - only Claude Code's sandbox holds the coordinator's commands (`contains`,
    `holds`, `provider-adapters/src/registry.ts:250-269`), works out a lead's
    from the start (`upFront`) and lets the coordinator judge permissions
    (`permissionJudge`, `:292`);
  - a pull request from outside can be reviewed on two agents of ten,
    Claude Code and OpenCode (`reviewing.outside`).

  ADR-077 was first written GitHub-first too: it gave GitLab draft releases,
  which GitLab doesn't have, and left the gated call reads only on every
  other host. On 31 October the person asked whether it works on other
  hosts, then: "engrain in our arch or adr that one feature shipped for one
  code host or tracker or agent should ship for all, if possible."
- **Decision:**
  - **A feature built for one service is built for every one of its kind
    that can have it:** code hosts, trackers and agents alike. Where it
    fits, that is the same change. Where it doesn't, the rest are tasks
    planned with it and named in its pull request, done in the same
    release, and the feature isn't done until they are.
  - **"Can have it" counts what Althar can stand in for,** not only what
    the service offers. Where Althar can build a feature from what a service
    does have, it does: an errand that merges one pull request at a time,
    each up to date and green, stands in for a merge queue, Althar's own
    merge for an update-branch button, the whole pipeline again for one
    step again. A gap is only what neither the service nor Althar can do.
  - **A gap is said, never silent.** The adapter's capabilities say it in
    code (`HostCapabilities`, `TrackerCapabilities`, the agent's registry
    entry). A screen shows a control only where it works. A tool refuses in
    the service's words, with why and what the person can do instead
    ("Bitbucket Cloud's API can't put a pull request in its queue; Add to
    queue is on its page"), never a no-op that looks done or a bare
    `false`.
  - **Features are written against the models,** not one service's API,
    so the runtime, its tools and the screens are the same for every
    service and only the adapter differs. A model term only one service has
    is a sign the feature is that service's (doc 06 says so already).
  - **Every adapter meets the feature's contract.** The feature adds its
    clause to the contract suite (`connectors/tests/contract.ts` for hosts
    and trackers, doc 03's for agents). The clause runs on every adapter's
    fake and recorded answers in CI, and on real accounts before a release.
    Where a capability is off, the clause checks the refusal, so a gap is
    tested too.
  - **Doc 06 and doc 03 keep the gaps,** each with why: the service can't,
    as of the day it was read, or it isn't built yet, with its task
    ([doc 06](../architecture/06-integrations-and-skills.md#every-service-alike),
    [doc 03](../architecture/03-agent-runtime-and-auth.md#every-agent-alike)).
    A service's change is a reason to read it again.
  - **A service's own thing ships as its counterpart elsewhere.** GitHub's
    environment approval is GitLab's deployment approval or manual job; a
    release is GitHub's draft, GitLab's release, Bitbucket's tag and
    downloads. Only where there is no counterpart does a feature stay one
    service's, and the gaps say so.
- **Alternatives considered:**
  - **One service first, the rest when someone asks:** how today's gaps
    came about. A person on GitLab finds a feature missing only by trying
    it, and nothing tells them why.
  - **Only what every service has:** GitHub's queue and Bitbucket Cloud's
    step logs would wait for the service that has least.
  - **A table of what each service supports, without the rule:** it
    records gaps without closing them.
- **Trade-off:** a feature costs more, about once more for each service's
  adapter, and ships later where the services differ most. The models keep
  the extra in the adapters, and the rest can follow as tasks in the same
  release, so one service doesn't hold up a feature's first change.
- **Applies first to:** [ADR-077](077-the-coordinator-merges-and-releases-on-the-person-s-word.md),
  whose build now covers every code host
  ([On every code host](077-the-coordinator-merges-and-releases-on-the-person-s-word.md#on-every-code-host)).
  The gaps outside it are the tasks [below](#build).
- **Revisit when:** a service joins; a new kind of service joins, such as a
  CI service like Jenkins, whose builds Bitbucket Data Center only links
  to; a service closes or opens a gap.

## Build

For 0.7.0, beside ADR-077's build: the coordinator plans these from this
list. Each title is a task's, in at most 60 characters.

| # | Task | Scope | Size | After |
| ---: | --- | --- | :---: | --- |
| 1 | Review outside PRs on GitLab and Bitbucket | `capabilities.reviews` on GitLab, Bitbucket Cloud and Data Center: read a change to review, with whether its author is one of the repository's people and its fork; post a review as comments on lines and a summary, never an approval (ADR-077). Bitbucket Cloud's membership needs the token's `read:workspace`, and without it everyone counts as an outsider, as now. Contract clause on each fake, recorded answers, real accounts | L | – |
| 2 | Start issues on GitHub and GitLab | `capabilities.starts`: GitLab's statuses where the server has them (its started category), GitHub's project Status field where the issue is on a project the notes name, else a label the notes name; said where none is | M | – |
| 3 | Priority and project on every tracker | Priority where a tracker has no field (GitHub's and GitLab's issues, Trello): a label the project's notes name, or GitHub's organization issue fields where they exist. Project: Jira Cloud moves an issue to another project, Trello a card to another board; Jira Data Center where its API can, said where it can't | M | – |
| 4 | Sandbox the coordinator on every agent that can | Read each agent's own sandbox, Codex's first, which has one of its own; `contains`, `holds` and `upFront` where it keeps commands to the folder and off the network as Claude Code's does (ADR-071); doc 03 says why for each that can't | M | – |
| 5 | The permission judge on every agent that can | `permissionJudge` where an agent's session can drop its built-in tools, hooks and own MCP servers; without it the person is asked, as now (ADR-019) | M | 4 |
| 6 | Outside reviews on every agent that can | `reviewing.outside` where an agent can be held to asking before every command, with nothing of the repository's loaded and nothing of its own on the network; Codex's entry says `false` today | M | 4 |

In order, after ADR-077's first three waves: 1, 2 and 4, beside ADR-077's
task 14; then 3, 5 and 6. ADR-077's task 9, 0.7.0's own release, still goes
last.
