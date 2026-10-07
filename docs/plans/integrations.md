# Integrations plan

> **Temporary.** The plan for building code hosts and trackers, not
> architecture: that is [06](../architecture/06-integrations-and-skills.md)
> and [ADR-011](../decisions/011-own-connectors-for-hosts-and-trackers.md).
> Delete this file when the last step ships, and move anything that lasted
> into the architecture docs.

Decided with the user on 1 October 2026.

## Goal

From the desktop app:

1. Connect GitHub and Linear (later GitLab, Jira, Bitbucket and Trello).
2. Paste an issue's link to the coordinator: it unfurls, and the task the
   coordinator drafts comes from it. Or start a task from one of your issues.
3. The plan ends with a draft pull request. Althar pushes the branch and
   opens it, with the issue's key in its title.
4. The task listens to its pull request. Comments, reviews and checks arrive
   in its thread. People's comments and failed checks reach the lead, which
   answers on the pull request or changes the code.
5. A ready task shows its pull request, its checks and its size. Marking it
   ready and merging stay with you.

Built to the product standard
([ADR-008](../decisions/008-shortcuts-in-behaviour-not-in-records.md)).

## Order

One pull request each:

1. **GitHub and Linear, and GitHub's issues.**
   - The connectors package: both models, the GitHub and Linear adapters,
     the fakes, and the contract suites.
   - Connections: device flow, PKCE and pasted tokens, sealed by the app.
   - The Draft PR step, and listening.
   - Agents' tools, and the rules for `gh` and `glab`.
   - Issues unfurled and tasks from issues.
   - The Connections panel and the accept card.
   - Built on the `integrations` branch. Not yet run against real
     accounts: Althar's GitHub App and Linear app aren't registered, so
     both take pasted tokens until they are.
2. **GitLab,** hosted and self-managed, with its issues.
   - The adapter: merge requests, drafts by their title, merging at the head
     the person saw, the head pipeline's jobs and their logs, threads and
     approvals, and its issues. Who can write to a project is asked of its
     members, since GitLab's comments don't say.
   - Nothing else changed: the runtime and the app offer any product with an
     adapter. Not yet run against a real account; its reads were tried
     against public projects on gitlab.com.
3. **Jira,** Cloud and Data Center.
4. **Bitbucket,** Cloud and Data Center, and **Trello.**

## For now

- **No status moves.** The key goes in the branch and the pull request's
  title, and that's all ([open question](../open-questions.md)).
- **Polling** every 30 seconds while a task listens, and on demand; no
  webhooks.
- **Marking ready and merging** are the person's.
- **The apps Althar signs in with** (its GitHub App, its Linear OAuth app,
  its GitLab application and its Trello Power-Up) are registered by the
  maintainers. Their public ids are build configuration. Until one is
  registered, its service takes a pasted token.

## Done when

- The goal above runs, end to end, against the fakes in CI and against real
  accounts on demand.
- Each adapter passes its model's contract suite.
- A restart while a pull request is being opened neither loses it nor opens
  two.
