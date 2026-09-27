import { FindingsReach, LimitPolicy, PermissionPolicy, TaskEnd } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CheckList, type CheckItem } from '../../primitives/CheckList/CheckList'
import { Choices, type ChoiceOption } from '../../primitives/Choices/Choices'
import { FormRow } from '../../primitives/FormRow/FormRow'
import { Panel } from '../../primitives/Panel/Panel'
import s from './ProjectRules.module.css'

/*
 * How much a project's agents ask you, decided once. The thread should
 * rarely stop for you; where it would, the answer is usually the same every
 * time, so it belongs to the project. Everything that does not wait for you
 * is still recorded on its task, as one quiet line.
 */

interface Option {
  title: string
  note: string
}

export interface ProjectRulesText {
  kicker: (project: string) => string
  title: string
  lede: string
  permissions: { label: string; note: string }
  permission: Record<PermissionPolicy, Option>
  always: { label: string; note: string; overridden: string }
  never: { label: string; note: string }
  addRule: string
  reach: { label: string; note: string }
  reachOption: Record<FindingsReach, Option>
  end: { label: string; note: string }
  endOption: Record<TaskEnd, Option>
  limits: { label: string; note: string }
  limit: Record<LimitPolicy, Option>
  foot: string
}

export const projectRulesText: ProjectRulesText = {
  kicker: (project) => `${project} · project rules`,
  title: 'When agents need a yes',
  lede: 'For every task in this project. A task can ask for less, never for more.',
  permissions: { label: 'Permissions', note: 'Commands, file writes outside the task, the web, MCP tools' },
  permission: {
    [PermissionPolicy.Lead]: {
      title: 'The agent in charge decides',
      note: 'Steps ask the lead. It allows what the task needs and passes the rest to you.',
    },
    [PermissionPolicy.AllowAll]: { title: 'Allow everything', note: 'Nothing asks. Every request is still recorded on its task.' },
    [PermissionPolicy.Ask]: { title: 'Ask me', note: 'Anything no rule covers waits for you.' },
  },
  always: { label: 'Always ask me', note: 'Whoever would answer, these wait for you', overridden: 'Off while everything is allowed' },
  never: { label: 'Never', note: 'Refused without asking anyone, even with everything allowed. Only this list changes it' },
  addRule: 'Add a rule',
  reach: { label: 'Review findings', note: 'What a review step finds, before the lead acts on it' },
  reachOption: {
    [FindingsReach.Stuck]: { title: 'Only when the lead can’t settle one', note: 'The lead fixes or sets aside the rest, and says why' },
    [FindingsReach.All]: { title: 'Every finding, before the lead acts', note: 'The lead waits for your pass over the list' },
    [FindingsReach.Learn]: { title: 'Every finding at first, then fewer', note: 'Asks less as you agree with the lead’s calls' },
  },
  end: { label: 'When a task is done', note: 'After its last step passes. Merging stays yours' },
  endOption: {
    [TaskEnd.DraftPr]: {
      title: 'Open a draft PR',
      note: 'CI runs on it; you mark it ready. The plan shows this step and you can change it per task.',
    },
    [TaskEnd.ReadyPr]: { title: 'Open a PR for review', note: 'Requests the usual reviewers as soon as the graph finishes.' },
    [TaskEnd.PushOnly]: { title: 'Push the branch only', note: 'You open the PR when you want one.' },
  },
  limits: { label: 'Usage limits', note: 'When a runtime’s account runs out, for the lead and every step on it' },
  limit: {
    [LimitPolicy.Move]: {
      title: 'Move the work to the next agent free',
      note: 'In the order of your connections. Moves back after the reset if it is still running.',
    },
    [LimitPolicy.Wait]: { title: 'Wait for the reset', note: 'The task keeps its place and resumes on its own.' },
    [LimitPolicy.Ask]: { title: 'Ask me', note: 'A card in the thread, with the agents that are free.' },
  },
  foot: 'Graph changes inside a run’s budget apply at once, with 10 seconds to undo. Changes beyond it always ask.',
}

const PERMISSIONS = [PermissionPolicy.Lead, PermissionPolicy.AllowAll, PermissionPolicy.Ask] as const
const REACHES = [FindingsReach.Stuck, FindingsReach.All, FindingsReach.Learn] as const
const ENDS = [TaskEnd.DraftPr, TaskEnd.ReadyPr, TaskEnd.PushOnly] as const
const LIMITS = [LimitPolicy.Move, LimitPolicy.Wait, LimitPolicy.Ask] as const

const options = <V extends string>(values: readonly V[], words: Record<V, Option>, extra?: Partial<Record<V, string>>): ChoiceOption<V>[] =>
  values.map((value) => ({
    value,
    title: words[value].title,
    note: extra?.[value] ? `${words[value].note} · ${extra[value]}` : words[value].note,
  }))

export interface ProjectRulesProps {
  project: string
  permissions?: PermissionPolicy
  defaultPermissions?: PermissionPolicy
  onPermissionsChange?: (value: PermissionPolicy) => void
  /** What always waits for you, whoever would answer: the project's own list. */
  always: readonly CheckItem[]
  /** The ids in `always` that are on. */
  alwaysOn?: readonly string[]
  defaultAlwaysOn?: readonly string[]
  onAlwaysOnChange?: (value: readonly string[]) => void
  /** Adds a rule to `always`; the button is shown only with it. */
  onAddRule?: () => void
  /** What is refused outright, whoever would answer and whatever the policy: the project's own list. Without it, no such row. */
  never?: readonly CheckItem[]
  /** The ids in `never` that are on. */
  neverOn?: readonly string[]
  defaultNeverOn?: readonly string[]
  onNeverOnChange?: (value: readonly string[]) => void
  /** Adds a rule to `never`; the button is shown only with it. */
  onAddNever?: () => void
  reach?: FindingsReach
  defaultReach?: FindingsReach
  onReachChange?: (value: FindingsReach) => void
  /** How far the lead's calls have been learned, after the learning choice: 6 of 10 so far. */
  learned?: string
  end?: TaskEnd
  defaultEnd?: TaskEnd
  onEndChange?: (value: TaskEnd) => void
  limits?: LimitPolicy
  defaultLimits?: LimitPolicy
  onLimitsChange?: (value: LimitPolicy) => void
  className?: string
  text?: Partial<ProjectRulesText>
}

/** A project's rules for asking you: who answers permissions, what always waits for you, what is never allowed, how review findings reach you, how a task ends, and what a usage limit does. */
export function ProjectRules({
  project,
  permissions: permissionsProp,
  defaultPermissions = PermissionPolicy.Lead,
  onPermissionsChange,
  always,
  alwaysOn: alwaysOnProp,
  defaultAlwaysOn = [],
  onAlwaysOnChange,
  onAddRule,
  never,
  neverOn: neverOnProp,
  defaultNeverOn = [],
  onNeverOnChange,
  onAddNever,
  reach: reachProp,
  defaultReach = FindingsReach.Stuck,
  onReachChange,
  learned,
  end: endProp,
  defaultEnd = TaskEnd.DraftPr,
  onEndChange,
  limits: limitsProp,
  defaultLimits = LimitPolicy.Move,
  onLimitsChange,
  className,
  text,
}: ProjectRulesProps) {
  const t = { ...projectRulesText, ...text }
  const [permissions, setPermissions] = useControlled(permissionsProp, defaultPermissions, onPermissionsChange)
  const [alwaysOn, setAlwaysOn] = useControlled<readonly string[]>(alwaysOnProp, defaultAlwaysOn, onAlwaysOnChange)
  const [neverOn, setNeverOn] = useControlled<readonly string[]>(neverOnProp, defaultNeverOn, onNeverOnChange)
  const [reach, setReach] = useControlled(reachProp, defaultReach, onReachChange)
  const [end, setEnd] = useControlled(endProp, defaultEnd, onEndChange)
  const [limits, setLimits] = useControlled(limitsProp, defaultLimits, onLimitsChange)
  const allowAll = permissions === PermissionPolicy.AllowAll

  return (
    <Panel kicker={t.kicker(project)} title={t.title} lede={t.lede} foot={t.foot} className={className}>
      <FormRow label={t.permissions.label} note={t.permissions.note}>
        <Choices label={t.permissions.label} options={options(PERMISSIONS, t.permission)} value={permissions} onChange={setPermissions} />
      </FormRow>

      <FormRow label={t.always.label} note={allowAll ? `${t.always.note}. ${t.always.overridden}` : t.always.note}>
        <div className={s.checks}>
          <CheckList label={t.always.label} items={always} value={alwaysOn} onChange={setAlwaysOn} disabled={allowAll} />
          {onAddRule && (
            <ActionButton icon="plus" onClick={onAddRule} className={s.add}>
              {t.addRule}
            </ActionButton>
          )}
        </div>
      </FormRow>

      {never && (
        <FormRow label={t.never.label} note={t.never.note}>
          <div className={s.checks}>
            <CheckList label={t.never.label} items={never} value={neverOn} onChange={setNeverOn} />
            {onAddNever && (
              <ActionButton icon="plus" onClick={onAddNever} className={s.add}>
                {t.addRule}
              </ActionButton>
            )}
          </div>
        </FormRow>
      )}

      <FormRow label={t.reach.label} note={t.reach.note}>
        <Choices
          label={t.reach.label}
          options={options(REACHES, t.reachOption, learned ? { [FindingsReach.Learn]: learned } : undefined)}
          value={reach}
          onChange={setReach}
        />
      </FormRow>

      <FormRow label={t.end.label} note={t.end.note}>
        <Choices label={t.end.label} options={options(ENDS, t.endOption)} value={end} onChange={setEnd} />
      </FormRow>

      <FormRow label={t.limits.label} note={t.limits.note}>
        <Choices label={t.limits.label} options={options(LIMITS, t.limit)} value={limits} onChange={setLimits} />
      </FormRow>
    </Panel>
  )
}
