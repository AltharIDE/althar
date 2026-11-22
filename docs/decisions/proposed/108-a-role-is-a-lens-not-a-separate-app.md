# ADR-108: A role is a lens, not a separate app

> A proposal, not built. Where it would fold in:
> [desktop-app.md](../desktop-app.md) (the lens and its switch),
> [tasks.md § Presets](../tasks.md#presets) (the order a lens gives them),
> and [what-agents-may-do.md](../what-agents-may-do.md) (a lens's default
> sandbox profile). The plan is [Althar for the whole team](../../plans/whole-team.md).

- **Status:** Proposed
- **Date:** 2026-11-22
- **Owner:** Desktop and runtime maintainers
- **Related:** [ADR-097, agents work as the person's own](../what-agents-may-do.md#what-asks),
  [ADR-015, how models are picked](../agents.md#how-models-are-picked),
  [ADR-065, Running and Up next](../scheduling.md#running-and-up-next),
  [ADR-100, a page beside the conversation](../desktop-app.md#a-web-page-beside-the-conversation),
  [ADR-109, features and stages](109-a-feature-moves-through-stages-kept-in-the-repository.md),
  [ADR-112, panels](112-panels-are-read-only-connectors-with-a-view-devops-first.md).

## Context

Althar is to carry a feature from product to devops. People in those roles
want different things first: a product manager the features and their
stages, a designer canvases and prototypes, a devops engineer the cluster
and its alerts. The question was how far apart their Althar should be.

## Decision

**A role is a lens over the same Althar.** The shell, navigation, task
cards, threads, canvases, rules and tools are the same for everyone. A role
changes defaults only:

| What | Today | What a lens sets |
|---|---|---|
| **Landing view** | Conversation and board side by side (`Room.Both`, `ProjectView.tsx`) | The room a project opens on; two new rooms, Features and Environments |
| **Pinned panels** | Nothing is open beside the conversation until something opens it (`ThreadHost.tsx`) | What the workbench shows when nothing else is open: a page, a canvas or a panel |
| **Board grouping and filters** | Fixed lanes, no grouping or filter (`features/board/lanes.ts`) | Rows by feature, stage or environment within the lanes, and a filter; the lanes stay |
| **Preset order** | Built-ins, then the person's by creation (`presetsIn`, `presets.ts`) | An order, and which presets come first in the picker |
| **Notification defaults** | App-wide switches per kind (`notifyCalls`, `notifyReady`, `notifyStopped`, `appPreferences.ts`) | Per-project defaults for those, and for a handoff ([ADR-110](110-a-stage-hands-over-when-its-artefact-merges.md)) |
| **Sandbox profile** | One for everyone (`sandboxReach.ts`, `registry.ts`) | The profile a new task starts with: Ops for devops, once Ops A adds it |
| **Default models** | The coordinator picks; the person tunes a preset's lead and reviewer (`preset_tunings`) | A lead and reviewer for its presets, below the person's own tunings |

- **Nothing is hidden or forbidden by a role.** Every room, preset, panel
  and tool stays reachable from every lens, and anyone can switch lens at
  any time from the project's header. A lens is never a permission: what
  an agent may do is the project's rules and the sandbox
  ([ADR-097](../what-agents-may-do.md#what-asks)), and what a person may
  merge is the code host's ([ADR-111](111-gates-live-on-the-code-host-and-the-tracker.md)).
- **The person's own choices win.** A lens is a layer of defaults under
  what the person set: a notification they turned off stays off, a preset
  they tuned keeps its tuning, a room they opened stays open.
- **Per person, per project, several allowed.** One person can be product
  on one project and engineering on another, or both on one. They look
  through one lens at a time; the others are a press away. A profile is
  one person today, so a person's roles are kept per project in the
  `settings` table beside the MCP servers and skills they switch on per
  project (`agentTools.ts`). With the Cloud they would come from team
  membership.
- **The built-in roles are product, design, engineering and devops.** A
  project defines its own in `.althar/flow.yaml`
  ([ADR-109](109-a-feature-moves-through-stages-kept-in-the-repository.md)),
  each starting from a built-in (`like: engineering`) and changing what it
  needs, so the whole team shares it through the repository.
- **No role set reads as engineering's lens.** A project nobody set a role
  on looks as it does today.
- **Role presets are ordinary presets.** Spec draft, Research summary,
  Runbook and Incident look join the built-ins: model-free, a brief and
  parts like the rest, listed for everyone, put first by their lens.

## Alternatives

- **An app or edition per role.** Four products to build, test and keep in
  step, and a handoff that crosses apps. Rejected: the person asked for one
  surface, and the next link must see what the last one did.
- **Roles as permissions.** Product can't run a change, design can't touch
  the code. Rejected: it hides work people do across roles, duplicates
  what the code host already enforces, and contradicts agents working as
  the person's own.
- **One role per person, everywhere.** Simpler to keep, wrong for people
  who wear different hats in different projects.
- **Only a preset filter.** Too little: the landing view and grouping are
  what make Althar read as a product manager's tool.

## Consequences

- A lens is cheap to switch and to get wrong: getting it wrong costs one
  press.
- Board grouping and filters are new work, useful without roles too.
- Every view has to be good enough for every role, as nothing is hidden.

## What an implementation touches

- `packages/contracts/src/settings.ts`, `packages/contracts/src/Api.ts`: a
  project's roles and the lens's fields.
- `packages/runtime/src/agentTools.ts` (per-project settings),
  `presets.ts` (`presetsIn` order, role presets), `presetModels.ts`,
  `sandboxReach.ts` (the default profile), `SettingsTools.ts` (agents
  change the role on the person's word).
- `packages/ui/src/foundations/vocabulary.ts` (`Room`: Features,
  Environments), `apps/desktop/src/renderer/features/project/ProjectView.tsx`
  and `rooms.ts` (landing room, the switch),
  `features/board/lanes.ts`, `BoardView.tsx`, `packages/ui/src/board/`
  (grouping and filter), `shared/ThreadHost.tsx` (pinned panels),
  `features/projectSettings/` (roles), `apps/desktop/src/main/appPreferences.ts`
  and `notify.ts` (notification defaults).
