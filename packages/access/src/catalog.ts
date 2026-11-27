/**
 * Every permission Althar checks, by name. Code checks permissions, never a role's name, so a custom role later is a
 * row, not a rewrite. A new feature adds its permission here in the same change, and the API's table of calls names it.
 */

/** Where a permission is held: on the whole organization, on one team (and the teams inside it), or on one project. */
export type Scope = 'organization' | 'team' | 'project'

export interface PermissionInfo {
  readonly scope: Scope
  /** What it lets someone do, in a line. */
  readonly about: string
  /** Comes as `own` (tasks the person started or was handed) or `any`. */
  readonly qualified?: true
  /** Changes a repository, so a grant limited to some repositories narrows it. */
  readonly writes?: true
  /** The person's own word: a service account or an agent never holds it, whatever its role. */
  readonly word?: true
}

export const catalog = {
  'org.view': { scope: 'organization', about: 'See the organization, its members and teams' },
  'org.manage': { scope: 'organization', about: 'Name, slug, avatar, default region, base access, domains' },
  'org.delete': { scope: 'organization', about: 'Delete or transfer the organization', word: true },
  'members.invite': { scope: 'organization', about: 'Invite people and make invite links, up to the inviter’s own access' },
  'members.manage': { scope: 'organization', about: 'Change members’ roles, suspend or remove them, answer join requests' },
  'roles.manage': { scope: 'organization', about: 'Define custom roles' },
  'sign_in.manage': { scope: 'organization', about: 'Single sign-on, directory sync, verified domains, required sign-in methods' },
  'billing.view': { scope: 'organization', about: 'See the plan, invoices and credits' },
  'billing.manage': { scope: 'organization', about: 'Change the plan, the payment method and credits', word: true },
  'spend.manage': { scope: 'organization', about: 'Spending limits for the organization, its teams, projects and members' },
  'usage.view': { scope: 'organization', about: 'Usage by member, project and meter' },
  'audit.view': { scope: 'organization', about: 'Read the audit log' },
  'audit.export': { scope: 'organization', about: 'Export and stream the audit log' },
  'integrations.manage': { scope: 'organization', about: 'The organization’s code host app, tracker workspaces' },
  'org.secrets.manage': { scope: 'organization', about: 'Organization secrets: provider API keys, registry tokens' },
  'service_accounts.manage': { scope: 'organization', about: 'Service accounts and their keys' },
  'homes.manage': { scope: 'organization', about: 'Hosted homes: create, region, maintenance window, restart, export, delete' },
  'pools.manage': { scope: 'organization', about: 'Pools: private workers, managed capacity, which projects may use them' },
  'functions.manage': { scope: 'organization', about: 'The organization’s list of functions' },

  'team.view': { scope: 'team', about: 'See the team, its members and its projects' },
  'team.manage': { scope: 'team', about: 'Rename the team, make teams inside it, set its default access' },
  'team.members.manage': { scope: 'team', about: 'Add and remove the team’s members and admins' },
  'team.setup.manage': { scope: 'team', about: 'The team’s presets, skills and MCP servers, and marking them required' },
  'team.spend.manage': { scope: 'team', about: 'Pass part of the team’s budget to the teams inside it' },
  'projects.create': { scope: 'team', about: 'Make projects owned by the team' },

  'project.view': { scope: 'project', about: 'See the board, tasks, threads, diffs, canvases, notes and rules' },
  'project.comment': { scope: 'project', about: 'Comment on canvases, findings and tasks' },
  'coordinator.talk': { scope: 'project', about: 'Talk to the coordinator, start, hold or change its plans' },
  'tasks.run': { scope: 'project', about: 'Make and start tasks', writes: true },
  'tasks.steer': {
    scope: 'project',
    about: 'Message, interrupt, switch model or agent, stop, reopen, take back, undo',
    qualified: true,
  },
  'asks.answer': { scope: 'project', about: 'Answer permission requests and questions', qualified: true, word: true },
  'changes.ship': { scope: 'project', about: 'Push branches, open pull requests, post screenshots', writes: true },
  'changes.merge': { scope: 'project', about: 'Merge, and push to the default branch', writes: true, word: true },
  'reviews.post': { scope: 'project', about: 'Post reviews on the code host' },
  'issues.manage': { scope: 'project', about: 'File and change issues in the tracker' },
  'notes.manage': { scope: 'project', about: 'Edit the project’s notes and decisions' },
  'runs.use': { scope: 'project', about: 'Run the project and open its previews' },
  'terminals.use': { scope: 'project', about: 'Type into a terminal on a task’s machine' },
  'work.download': { scope: 'project', about: 'Copy a task’s work to your own computer' },
  'compute.spend': { scope: 'project', about: 'Place work on paid cloud capacity, within the member’s limit' },
  'automations.run': { scope: 'project', about: 'Run an automation now' },
  'automations.manage': { scope: 'project', about: 'Make, change or delete automations' },
  'tools.manage': { scope: 'project', about: 'The project’s MCP servers, skills and agents' },
  'repositories.manage': { scope: 'project', about: 'Add or leave out repositories' },
  'rules.tighten': { scope: 'project', about: 'Make agents ask about more' },
  'rules.loosen': { scope: 'project', about: 'Make agents ask about less', word: true },
  'project.manage': { scope: 'project', about: 'Name, ink, presets, ship route, review seal, tracker' },
  'project.setup.manage': { scope: 'project', about: 'The project’s presets, skills and MCP servers, and marking them required' },
  'secrets.manage': { scope: 'project', about: 'The project’s secrets' },
  'places.manage': { scope: 'project', about: 'Which pools and workers the project’s work may use' },
  'project.access': { scope: 'project', about: 'Grant and revoke access to the project' },
  'project.delete': { scope: 'project', about: 'Remove the project', word: true },
  'project.transfer': { scope: 'project', about: 'Give the project to another team or owner', word: true },
} as const satisfies Record<string, PermissionInfo>

export type Permission = keyof typeof catalog

export const permissions = Object.keys(catalog) as ReadonlyArray<Permission>

export const isPermission = (name: string): name is Permission => Object.hasOwn(catalog, name)

export const permissionInfo = (permission: Permission): PermissionInfo => catalog[permission]

/** Bumped when a permission is removed or changes meaning; adding one doesn't need it. Access lists carry it. */
export const CATALOG_VERSION = 1
