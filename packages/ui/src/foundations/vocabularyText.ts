/*
 * The words for the vocabularies that more than one component offers as a
 * choice: the project's rules, the plan's last step, a review's reach. One
 * table each, so a setting reads the same wherever it is changed. English
 * defaults, like every component's `text`; a consumer passes its own.
 */
import { FindingsReach, LimitPolicy, PermissionPolicy, TaskEnd } from './vocabulary'

export interface ChoiceWords {
  title: string
  /** What choosing it means, in a line. */
  note: string
}

export const permissionPolicyText: Record<PermissionPolicy, ChoiceWords> = {
  [PermissionPolicy.Rules]: {
    title: 'Allow, except what you keep',
    note: 'Agents carry on without stopping. What “Always ask me” lists waits for you; what “Never” lists is refused.',
  },
  [PermissionPolicy.Lead]: {
    title: 'The agent in charge decides',
    note: 'Each task has one agent in charge of it, its lead. It allows what the task needs and passes the rest to you.',
  },
  [PermissionPolicy.AllowAll]: { title: 'Allow everything', note: 'Nothing asks. Every request is still recorded on its task.' },
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
    note: 'In the order of your connections. Moves back after the reset if it is still running.',
  },
  [LimitPolicy.Wait]: { title: 'Wait for the reset', note: 'The task keeps its place and resumes on its own.' },
  [LimitPolicy.Ask]: { title: 'Ask me', note: 'A card in the thread, with the agents that are free.' },
}
