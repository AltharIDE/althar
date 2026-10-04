import { type FormEvent, useEffect, useId, useRef, useState } from 'react'

import { FindingsReach, LimitPolicy, PermissionPolicy, TaskEnd } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { CheckList, type CheckItem } from '../../primitives/CheckList/CheckList'
import { Choices, type ChoiceOption } from '../../primitives/Choices/Choices'
import { Field, FieldError } from '../../primitives/Field/Field'
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
  /** The form a rule is added with: a command, by how it starts. */
  rule: { field: string; placeholder: string; note: string; empty: string; add: string; cancel: string }
  reach: { label: string; note: string }
  reachOption: Record<FindingsReach, Option>
  end: { label: string; note: string }
  endOption: Record<TaskEnd, Option>
  limits: { label: string; note: string }
  limit: Record<LimitPolicy, Option>
  accounts: { label: string; note: string; allowed: (agent: string) => string }
  rotate: { first: Option; next: Option }
  foot: string
}

export const projectRulesText: ProjectRulesText = {
  kicker: (project) => `${project} · project rules`,
  title: 'When agents need a yes',
  lede: 'For every task in this project. A task can ask for less, never for more.',
  permissions: { label: 'Permissions', note: 'Commands, file writes outside the task, the web, MCP tools' },
  permission: {
    [PermissionPolicy.Rules]: {
      title: 'Allow, except what you keep',
      note: 'Agents carry on without stopping. What “Always ask me” lists waits for you; what “Never” lists is refused.',
    },
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
  rule: {
    field: 'A command, as it starts',
    placeholder: 'terraform apply',
    note: 'Its words in order, * for anything. It holds for what an agent asks to do beyond its sandbox: the network, or outside the task.',
    empty: 'Type how the command starts',
    add: 'Add',
    cancel: 'Cancel',
  },
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
  accounts: {
    label: 'Accounts',
    note: 'For an agent you have more than one account with',
    allowed: (agent) => `${agent} accounts this project may use`,
  },
  rotate: {
    first: {
      title: 'Its first account',
      note: 'Work runs on each agent’s first account here, in your order. When it runs out, the usage limit rule applies.',
    },
    next: {
      title: 'The next account, when one runs out',
      note: 'Work goes on with the agent’s next account here, then as the usage limit rule says.',
    },
  },
  foot: 'Graph changes inside a run’s budget apply at once, with 10 seconds to undo. Changes beyond it always ask.',
}

const PERMISSIONS = [PermissionPolicy.Lead, PermissionPolicy.AllowAll, PermissionPolicy.Ask] as const
type Rotation = 'first' | 'next'
const REACHES = [FindingsReach.Stuck, FindingsReach.All, FindingsReach.Learn] as const
const ENDS = [TaskEnd.DraftPr, TaskEnd.ReadyPr, TaskEnd.PushOnly] as const
const LIMITS = [LimitPolicy.Move, LimitPolicy.Wait, LimitPolicy.Ask] as const

const options = <V extends string>(values: readonly V[], words: Record<V, Option>, extra?: Partial<Record<V, string>>): ChoiceOption<V>[] =>
  values.map((value) => ({
    value,
    title: words[value].title,
    note: extra?.[value] ? `${words[value].note} · ${extra[value]}` : words[value].note,
  }))

/** An agent with its accounts, for the accounts row. */
export interface AgentAccounts {
  id: string
  name: string
  accounts: readonly CheckItem[]
}

export interface ProjectRulesProps {
  project: string
  /** Which ways of answering to offer, in order. The lead, everything, or you, unless given. */
  permissionOptions?: readonly PermissionPolicy[]
  permissions?: PermissionPolicy
  defaultPermissions?: PermissionPolicy
  onPermissionsChange?: (value: PermissionPolicy) => void
  /** What always waits for you, whoever would answer: the project's own list. */
  always: readonly CheckItem[]
  /** The ids in `always` that are on. */
  alwaysOn?: readonly string[]
  defaultAlwaysOn?: readonly string[]
  onAlwaysOnChange?: (value: readonly string[]) => void
  /** Adds a rule to `always`: a command, by how it starts. The button is shown only with it. */
  onAddRule?: (pattern: string) => void
  /** What is refused outright, whoever would answer and whatever the policy: the project's own list. Without it, no such row. */
  never?: readonly CheckItem[]
  /** The ids in `never` that are on. */
  neverOn?: readonly string[]
  defaultNeverOn?: readonly string[]
  onNeverOnChange?: (value: readonly string[]) => void
  /** Adds a rule to `never`: a command, by how it starts. The button is shown only with it. */
  onAddNever?: (pattern: string) => void
  reach?: FindingsReach
  defaultReach?: FindingsReach
  /** Without it, no review findings row. */
  onReachChange?: (value: FindingsReach) => void
  /** How far the lead's calls have been learned, after the learning choice: 6 of 10 so far. */
  learned?: string
  end?: TaskEnd
  defaultEnd?: TaskEnd
  onEndChange?: (value: TaskEnd) => void
  /** Which usage limit choices to offer, in order. All three, unless given. */
  limitOptions?: readonly LimitPolicy[]
  limits?: LimitPolicy
  defaultLimits?: LimitPolicy
  onLimitsChange?: (value: LimitPolicy) => void
  /** The agents with more than one account. Without it, no accounts row. */
  agentAccounts?: readonly AgentAccounts[]
  /** Whether work goes on with an agent's next account when one runs out. */
  rotate?: boolean
  defaultRotate?: boolean
  onRotateChange?: (value: boolean) => void
  /** The accounts the project may use, by agent; an agent not named may use every one. */
  allowed?: Readonly<Record<string, readonly string[]>>
  onAllowedChange?: (agentId: string, accountIds: readonly string[]) => void
  className?: string
  text?: Partial<ProjectRulesText>
}

/** A project's rules for asking you: who answers permissions, what always waits for you, what is never allowed, how review findings reach you, how a task ends, and what a usage limit does. */
export function ProjectRules({
  project,
  permissionOptions = PERMISSIONS,
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
  limitOptions = LIMITS,
  limits: limitsProp,
  defaultLimits = LimitPolicy.Move,
  onLimitsChange,
  agentAccounts,
  rotate: rotateProp,
  defaultRotate = false,
  onRotateChange,
  allowed = {},
  onAllowedChange,
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
  const [rotate, setRotate] = useControlled(rotateProp, defaultRotate, onRotateChange)
  const allowAll = permissions === PermissionPolicy.AllowAll
  const rotation: Rotation = rotate ? 'next' : 'first'

  return (
    <Panel kicker={t.kicker(project)} title={t.title} lede={t.lede} foot={t.foot === '' ? undefined : t.foot} className={className}>
      <FormRow label={t.permissions.label} note={t.permissions.note}>
        <Choices
          label={t.permissions.label}
          options={options(permissionOptions, t.permission)}
          value={permissions}
          onChange={setPermissions}
        />
      </FormRow>

      <FormRow label={t.always.label} note={allowAll ? `${t.always.note}. ${t.always.overridden}` : t.always.note}>
        <div className={s.checks}>
          <CheckList label={t.always.label} items={always} value={alwaysOn} onChange={setAlwaysOn} disabled={allowAll} />
          {onAddRule && <AddRule t={t} onAdd={onAddRule} />}
        </div>
      </FormRow>

      {never && (
        <FormRow label={t.never.label} note={t.never.note}>
          <div className={s.checks}>
            <CheckList label={t.never.label} items={never} value={neverOn} onChange={setNeverOn} />
            {onAddNever && <AddRule t={t} onAdd={onAddNever} />}
          </div>
        </FormRow>
      )}

      {onReachChange && (
        <FormRow label={t.reach.label} note={t.reach.note}>
          <Choices
            label={t.reach.label}
            options={options(REACHES, t.reachOption, learned ? { [FindingsReach.Learn]: learned } : undefined)}
            value={reach}
            onChange={setReach}
          />
        </FormRow>
      )}

      <FormRow label={t.end.label} note={t.end.note}>
        <Choices label={t.end.label} options={options(ENDS, t.endOption)} value={end} onChange={setEnd} />
      </FormRow>

      <FormRow label={t.limits.label} note={t.limits.note}>
        <Choices label={t.limits.label} options={options(limitOptions, t.limit)} value={limits} onChange={setLimits} />
      </FormRow>

      {agentAccounts && agentAccounts.length > 0 && (
        <FormRow label={t.accounts.label} note={t.accounts.note}>
          <div className={s.checks}>
            <Choices
              label={t.accounts.label}
              options={options(['first', 'next'] as const, t.rotate)}
              value={rotation}
              onChange={(value) => setRotate(value === 'next')}
            />
            {agentAccounts.map((agent) => (
              <CheckList
                key={agent.id}
                label={t.accounts.allowed(agent.name)}
                items={agent.accounts}
                value={allowed[agent.id] ?? agent.accounts.map((account) => account.id)}
                onChange={(ids) => onAllowedChange?.(agent.id, ids)}
                disabled={onAllowedChange === undefined}
              />
            ))}
          </div>
        </FormRow>
      )}
    </Panel>
  )
}

/** "Add a rule", then a command by how it starts, added as the list's. */
function AddRule({ t, onAdd }: { t: ProjectRulesText; onAdd: (pattern: string) => void }) {
  const [open, setOpen] = useState(false)
  const [pattern, setPattern] = useState('')
  const [empty, setEmpty] = useState(false)
  const fieldId = useId()
  const noteId = useId()
  const errorId = useId()
  const field = useRef<HTMLInputElement>(null)
  // Opened, the form starts in its field.
  useEffect(() => {
    if (open) field.current?.focus()
  }, [open])
  if (!open)
    return (
      <ActionButton icon="plus" onClick={() => setOpen(true)} className={s.add}>
        {t.addRule}
      </ActionButton>
    )
  const close = () => {
    setOpen(false)
    setPattern('')
    setEmpty(false)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (pattern.trim() === '') return setEmpty(true)
    onAdd(pattern.trim())
    close()
  }
  return (
    <form className={s.rule} onSubmit={submit}>
      <label className={s.label} htmlFor={fieldId}>
        {t.rule.field}
      </label>
      <span className={s.ruleRow}>
        <Field
          id={fieldId}
          ref={field}
          className={s.pattern}
          value={pattern}
          placeholder={t.rule.placeholder}
          invalid={empty}
          aria-describedby={[noteId, empty ? errorId : ''].filter(Boolean).join(' ')}
          onChange={(event) => {
            setPattern(event.target.value)
            setEmpty(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close()
          }}
        />
        <Button size="small" type="submit">
          {t.rule.add}
        </Button>
        <Button size="small" variant="quiet" type="button" onClick={close}>
          {t.rule.cancel}
        </Button>
      </span>
      {empty && <FieldError id={errorId}>{t.rule.empty}</FieldError>}
      <span id={noteId} className={s.note}>
        {t.rule.note}
      </span>
    </form>
  )
}
