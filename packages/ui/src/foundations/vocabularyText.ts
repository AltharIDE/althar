/*
 * The words for the vocabularies that more than one component offers as a
 * choice: the project's rules, the plan's last step, a review's reach. One
 * table each, so a setting reads the same wherever it is changed. English
 * defaults, like every component's `text`; a consumer passes its own.
 */
import { FindingsReach, LimitPolicy, PermissionPolicy, RepositoryRole, TaskEnd } from './vocabulary'

export interface ChoiceWords {
  title: string
  /** What choosing it means, in a line. */
  note: string
}

export const permissionPolicyText: Record<PermissionPolicy, ChoiceWords> = {
  [PermissionPolicy.Rules]: {
    title: 'Allow, except what you keep',
    note: '“Always ask me” waits for you; “Never” is refused.',
  },
  [PermissionPolicy.Coordinator]: {
    title: 'The coordinator decides',
    note: 'What it can’t decide waits for you.',
  },
  [PermissionPolicy.AllowAll]: { title: 'Allow everything', note: 'Nothing asks.' },
  [PermissionPolicy.Ask]: { title: 'Ask me', note: 'Anything no rule covers waits for you.' },
}

export const findingsReachText: Record<FindingsReach, ChoiceWords & { short: string }> = {
  [FindingsReach.Stuck]: {
    title: 'Only when the lead can’t settle one',
    note: 'The lead fixes or sets aside the rest, and says why',
    short: 'only when the lead can’t settle one',
  },
  [FindingsReach.All]: {
    title: 'Every finding, before the lead acts',
    note: 'The lead waits for your pass over the list',
    short: 'every finding, before the lead acts',
  },
  [FindingsReach.Learn]: {
    title: 'Every finding at first, then fewer',
    note: 'Asks less as you agree with the lead’s calls',
    short: 'every finding at first, then fewer',
  },
}

export const taskEndText: Record<TaskEnd, ChoiceWords & { short: string }> = {
  [TaskEnd.DraftPr]: { title: 'Open a draft PR', note: 'CI runs on it; you mark it ready', short: 'Draft PR' },
  [TaskEnd.ReadyPr]: { title: 'Open a PR for review', note: 'Requests the usual reviewers', short: 'PR for review' },
  [TaskEnd.PushOnly]: { title: 'Push the branch only', note: 'No PR; you open it when you want one', short: 'Push branch' },
}

export const limitPolicyText: Record<LimitPolicy, ChoiceWords> = {
  [LimitPolicy.Move]: {
    title: 'Move the work to the next agent free',
    note: 'Back after the reset, if still running',
  },
  [LimitPolicy.Wait]: { title: 'Wait for the reset', note: 'Resumes on its own' },
  [LimitPolicy.Ask]: { title: 'Ask me', note: 'With the agents that are free' },
}

/** A repository's role, as a choice names it. */
export const repositoryRoleText: Record<RepositoryRole, string> = {
  [RepositoryRole.Service]: 'Service',
  [RepositoryRole.Frontend]: 'Frontend',
  [RepositoryRole.Infrastructure]: 'Infrastructure',
  [RepositoryRole.Library]: 'Library',
  [RepositoryRole.Docs]: 'Docs',
  [RepositoryRole.Other]: 'Other',
}
