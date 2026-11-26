# @althar/access

Who may do what in a shared project, and which setup reaches whom. Althar Cloud and every home that serves an organization run the same code here, so they give the same answer. It is pure: no I/O, no clock of its own (callers pass the time), and nothing about SQLite, Postgres or Electron.

| Module | What it holds |
| --- | --- |
| [catalog.ts](src/catalog.ts) | Every permission, by name, with its scope (organization, team or project) and whether it comes as `own` or `any`, changes repositories, or needs the person's own word |
| [roles.ts](src/roles.ts) | The built-in roles: Owner, Admin, Member, Billing manager and Auditor on the organization; View, Contribute, Maintain and Admin on a project; what a team admin may do |
| [list.ts](src/list.ts) | The access list the cloud compiles for one home: teams, functions, people, service accounts, projects and grants |
| [authorize.ts](src/authorize.ts) | `authorize`: may this person or service account do this, here? Also what someone reaches on a project, which projects they can see, and whether they hold a seat |
| [sign.ts](src/sign.ts) | Signing an access list with Ed25519, and the checks a home runs before keeping one |
| [setup.ts](src/setup.ts) | Which presets, skills and MCP servers reach one person on one project, from the organization, its teams, the project and the person |
| [overlap.ts](src/overlap.ts) | Which other tasks a plan or a running task runs into, by repository and path |
| [wakes.ts](src/wakes.ts) | The limits on agents messaging and waking teammates' agents, and what a woken agent may do on that request alone |

## The rules it keeps

- **Code checks permissions, never a role's name.** A custom role later is data on the same tables.
- **Access only adds up.** Grants, teams' grants, the owning team's default and the organization's base access combine, and the highest wins. There are no deny rules.
- **Membership counts upward, administration reaches downward.** Someone in FX Manager also counts as in Markets, which it sits in. An admin of Markets runs FX Manager's projects.
- **A private project is reached by grants alone.** Base access, a team's default and an organization admin's role don't reach it.
- **A grant can be limited** to some repositories, and can end on a date.
- **A service account never gives the person's word.** It can't answer an ask, merge or loosen rules, whatever its role.
- **Setup follows the project.** A team's people can carry recommendations onto other teams' projects, never requirements.
- **Answer "not found" for what someone can't see,** never "forbidden".

## Work on it

From `packages/access`:

| Command | What it does |
| --- | --- |
| `bun run check` | Format, type-aware lint and type checks |
| `bun run test` | The tests |
| `bun run test:coverage` | The tests with the coverage gate: 90% of lines and branches |
| `bun run verify` | Check and coverage, as CI runs them |
