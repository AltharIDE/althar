import {
  type Choice,
  type ChosenField,
  type ConnectorFailed,
  fieldsOf,
  type Issue,
  type IssueChange,
  type IssueField,
  type ParentIssue,
  parseLink,
  type Priority,
  type Product,
  products,
  type Tracker,
} from '@althar/connectors'
import { Effect, Schema } from 'effect'

import { ToolRefused } from './ToolServer'

/*
 * An issue's fields as agents name them, read against its tracker
 * (DEV-182): what a change to an issue sets, and what an issue is filed
 * with. Each field is read on its own, so a name the tracker hasn't leaves
 * that field off and says why, and the rest still goes ahead: a change is
 * never all or nothing. What is so already is left off too, and said so.
 * A field the tracker hasn't (ADR-082: what one tracker can do, each can
 * where it has the field) is said in words of that tracker's.
 */

/** What an agent asks of an issue's fields, in the tracker's names for things: each left out stays as it is. */
export interface Wanted {
  readonly status?: string
  readonly close?: boolean
  readonly priority?: Priority
  /** Someone to put on it, by name, login or email, or `me` for the person; null takes everyone off. */
  readonly assignee?: string | null
  /** People to take off it, by name, login or email. */
  readonly unassign?: ReadonlyArray<string>
  readonly labels?: { readonly add?: ReadonlyArray<string>; readonly remove?: ReadonlyArray<string> }
  /** A project, milestone or cycle by name; null for none. */
  readonly project?: string | null
  readonly milestone?: string | null
  readonly cycle?: string | null
  /** Another issue on the same tracker, by its key or link; null for none. */
  readonly parent?: string | null
  readonly estimate?: number | null
  readonly type?: string
  /** The components it is in after, by name, in place of those it had. */
  readonly components?: ReadonlyArray<string>
  /** A day, 2026-11-30; null for none. */
  readonly due?: string | null
  readonly title?: string
  readonly description?: string
}

/** What a field is called, said to an agent. */
export const FIELD_WORDS: Readonly<Record<IssueField, string>> = {
  status: 'status',
  close: 'closing it',
  priority: 'priority',
  assignee: 'assignee',
  labels: 'labels',
  project: 'project',
  milestone: 'milestone',
  cycle: 'cycle',
  parent: 'parent issue',
  estimate: 'estimate',
  type: 'type',
  components: 'components',
  due: 'due date',
  title: 'title',
  description: 'description',
}

const jira = (product: Product) => product === 'jira_cloud' || product === 'jira_dc'

/** Why a tracker can't set a field, said to an agent in its own terms: what each product's issues lack. */
export const gapOf = (product: Product, field: IssueField): string => {
  const name = products[product].name
  switch (field) {
    case 'priority':
      return `${name}'s issues have no priority`
    case 'project':
      return product === 'trello'
        ? 'a Trello card’s project is its board'
        : jira(product)
          ? 'Jira moves an issue to another project only by its own Move'
          : product === 'gitlab'
            ? 'a GitLab issue’s project is where it lives: moving it is GitLab’s own Move'
            : `${name} has no project for an issue`
    case 'milestone':
      return product === 'trello' ? 'a Trello card has no milestone' : `${name} has no milestone for an issue`
    case 'cycle':
      return jira(product)
        ? 'Jira’s sprints belong to its boards: Althar can’t set one yet'
        : product === 'gitlab'
          ? 'GitLab’s iterations are a group’s, on its paid tiers: Althar can’t set one yet'
          : `only Linear has cycles`
    case 'parent':
      return product === 'gitlab'
        ? 'GitLab’s epics are a group’s, on its paid tiers: Althar can’t set one yet'
        : product === 'trello'
          ? 'a Trello card has no parent'
          : `${name}'s issues have no parent`
    case 'estimate':
      return jira(product)
        ? 'Jira’s story points are a field each site names: Althar can’t set them yet'
        : product === 'trello'
          ? 'a Trello card has no estimate'
          : `${name}'s issues have no estimate`
    case 'type':
      return product === 'linear'
        ? 'Linear has no issue types: a label says what kind it is'
        : product === 'trello'
          ? 'a Trello card has no type'
          : `${name}'s issues have no type`
    case 'components':
      return 'only Jira has components'
    case 'due':
      return product === 'github' ? 'GitHub’s issues have no due date' : `${name}'s issues have no due date`
    default:
      return `Althar can’t change that on ${name} yet`
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** How many choices are said to an agent at most. */
const CHOICES = 25

/** Names in a line, cut short past a few dozen. */
export const listed = (names: ReadonlyArray<string>) =>
  names.length === 0
    ? 'none'
    : names.length > CHOICES
      ? `${names.slice(0, CHOICES).join(', ')} and ${names.length - CHOICES} more`
      : names.join(', ')

/** A choice by what was typed for it: its id, its name or another word it answers to, in any case; or the one name it begins. */
export const choiceNamed = (choices: ReadonlyArray<Choice>, typed: string): Choice | undefined =>
  choices.find((choice) => same(choice.id, typed) || same(choice.name, typed) || (choice.also ?? []).some((word) => same(word, typed))) ??
  (() => {
    const starting = choices.filter((choice) => choice.name.toLowerCase().startsWith(typed.trim().toLowerCase()))
    return starting.length === 1 ? starting[0] : undefined
  })()

/** Words that mean the person, for an assignee. */
const ME = /^(me|myself|the person|the user|you)$/i

/** A day as trackers take it. */
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Where the fields are read: the tracker, its issue where there is one already, and what its fields can be. */
export interface FieldsAt {
  readonly tracker: Tracker
  readonly product: Product
  /** Its tracker, by its product's name. */
  readonly name: string
  /** The issue as its tracker has it now, for a change; none for one still to file. */
  readonly issue?: Issue
  /** Its repository's path, for a code host's `#12`. */
  readonly repository?: string
  /** What a field can be set to here: `choices` for an issue, `choicesIn` for a container. */
  readonly choices: (field: ChosenField, wanted?: string) => Effect.Effect<ReadonlyArray<Choice>, ConnectorFailed>
}

/** What came of reading what was asked: the change, by the tracker's own ids; what was left off, and why; and what was so already. */
export interface Read {
  readonly change: IssueChange
  readonly left: ReadonlyArray<string>
  readonly already: ReadonlyArray<string>
}

/** A field read, or why it was left off. */
type Field<A> = { readonly to: A } | { readonly left: string } | { readonly already: string }

const left = (why: string): { readonly left: string } => ({ left: why })

/**
 * What an agent asked, read against the tracker, field by field: each name
 * to the tracker's own, what is so already left off and said, and a field
 * the tracker can't set, or a name it hasn't, left off with why.
 */
export const readFields = (at: FieldsAt, wanted: Wanted): Effect.Effect<Read> =>
  Effect.gen(function* () {
    const { tracker, product, name, issue } = at
    const can = (field: IssueField) => tracker.capabilities.changes.includes(field)
    const cant = (field: IssueField) => left(`Althar can’t set its ${FIELD_WORDS[field]} on ${name}: ${gapOf(product, field)}`)
    /** The choices for a field, or why the tracker couldn't give them. */
    const ask = (field: ChosenField, typed?: string) =>
      at
        .choices(field, typed)
        .pipe(Effect.mapError((error) => `${name} couldn’t say what its ${FIELD_WORDS[field]} can be: ${error.message}`))
    /** A name read against the tracker's choices, or why it isn't one. */
    const pick = (field: ChosenField, typed: string, what = FIELD_WORDS[field]) =>
      Effect.flatMap(ask(field, typed), (choices) => {
        const chosen = choiceNamed(choices, typed)
        return chosen === undefined
          ? Effect.fail(`no ${what} called “${typed.trim()}”. It has: ${listed(choices.map((choice) => choice.name))}`)
          : Effect.succeed(chosen)
      })
    /** One field, its failure said as left off. */
    const one = <A>(field: IssueField, read: Effect.Effect<Field<A>, string>): Effect.Effect<Field<A>> =>
      can(field) ? Effect.catch(read, (why) => Effect.succeed(left(why))) : Effect.succeed(cant(field))
    /** A choice, or null for none, so already where the issue has it. */
    const chosenOr = (field: 'project' | 'milestone' | 'cycle' | 'type', typed: string | null, has: string | null | undefined) =>
      one<Choice | null>(
        field,
        typed === null
          ? Effect.succeed(has === null ? { already: `no ${FIELD_WORDS[field]}` } : { to: null })
          : Effect.map(pick(field, typed), (chosen) =>
              has !== undefined && has !== null && same(has, chosen.name)
                ? { already: `${FIELD_WORDS[field]} ${chosen.name}` }
                : { to: chosen },
            ),
      )

    const status =
      wanted.status === undefined
        ? undefined
        : yield* one<Choice>(
            'status',
            Effect.map(pick('status', wanted.status), (chosen) =>
              issue !== undefined && same(chosen.name, issue.status.name) ? { already: `status ${chosen.name}` } : { to: chosen },
            ),
          )
    const ended = issue !== undefined && (issue.status.category === 'done' || issue.status.category === 'cancelled')
    const close =
      wanted.close !== true
        ? undefined
        : yield* one<true>('close', Effect.succeed(ended ? { already: `closed (${issue?.status.name ?? ''})` } : { to: true }))
    const priority =
      wanted.priority === undefined
        ? undefined
        : yield* one<Priority>(
            'priority',
            Effect.succeed(
              issue !== undefined && (issue.priority?.level ?? 'none') === wanted.priority
                ? { already: `${issue.priority?.name ?? 'no'} priority` }
                : { to: wanted.priority },
            ),
          )
    const assignee =
      wanted.assignee === undefined && (wanted.unassign ?? []).length === 0
        ? undefined
        : yield* one<NonNullable<IssueChange['assignee']> | null>(
            'assignee',
            Effect.gen(function* () {
              const on = issue?.assignees ?? []
              const isOn = (choice: Choice) =>
                on.some(
                  (person) =>
                    person.id === choice.id ||
                    same(person.login, choice.name) ||
                    [choice.name, ...(choice.also ?? [])].some((word) => same(word, person.login) || same(word, person.name ?? '')),
                )
              if (wanted.assignee === null) return on.length === 0 && issue !== undefined ? { already: 'unassigned' } : { to: null }
              const person = (typed: string) =>
                ME.test(typed.trim())
                  ? Effect.gen(function* () {
                      // The person, as the connection signs in.
                      const account = yield* tracker.account.pipe(Effect.mapError((error) => error.message))
                      const choices = yield* ask('assignee', account.login)
                      const mine = choices.find(
                        (choice) =>
                          choice.id === account.id ||
                          same(choice.name, account.login) ||
                          (choice.also ?? []).some((word) => same(word, account.login)),
                      )
                      return mine ?? (yield* Effect.fail(`it can’t be assigned to the account Althar signs in as, ${account.login}`))
                    })
                  : pick('assignee', typed, 'one to assign')
              const add = wanted.assignee === undefined ? [] : [yield* person(wanted.assignee)]
              // One not on it is nothing to take off.
              const remove = (yield* Effect.forEach(wanted.unassign ?? [], person)).filter(isOn)
              const adding = add.filter((choice) => !isOn(choice) || (tracker.capabilities.assignees === 'one' && on.length > 1))
              if (adding.length === 0 && remove.length === 0)
                return {
                  already: on.length === 0 ? 'unassigned' : `assigned to ${on.map((one) => one.name ?? one.login).join(', ')}`,
                }
              return { to: { add: adding, remove } }
            }),
          )
    const labels =
      wanted.labels === undefined || ((wanted.labels.add ?? []).length === 0 && (wanted.labels.remove ?? []).length === 0)
        ? undefined
        : yield* one<NonNullable<IssueChange['labels']>>(
            'labels',
            Effect.gen(function* () {
              const all = yield* ask('labels')
              // A tracker that makes any label it is given offers the one asked for when asked for it.
              const label = (typed: string) =>
                choiceNamed(all, typed) !== undefined
                  ? Effect.succeed(choiceNamed(all, typed) as Choice)
                  : Effect.flatMap(ask('labels', typed), (more) => {
                      const found = choiceNamed(more, typed)
                      return found === undefined
                        ? Effect.fail(`no label called “${typed.trim()}”. It has: ${listed(all.map((choice) => choice.name))}`)
                        : Effect.succeed(found)
                    })
              const had = issue?.labels ?? []
              const has = (choice: Choice) => had.some((name) => same(name, choice.name))
              const add = (yield* Effect.forEach(wanted.labels?.add ?? [], label)).filter((choice) => !has(choice))
              // One it hasn't is nothing to take off.
              const remove = (yield* Effect.forEach(
                (wanted.labels?.remove ?? []).filter((typed) => had.some((name) => same(name, typed))),
                label,
              )).filter(has)
              return add.length === 0 && remove.length === 0 ? { already: 'labels as asked' } : { to: { add, remove } }
            }),
          )
    const project = wanted.project === undefined ? undefined : yield* chosenOr('project', wanted.project, issue?.project?.name ?? undefined)
    const milestone =
      wanted.milestone === undefined
        ? undefined
        : yield* one<Choice | null>(
            'milestone',
            wanted.milestone === null
              ? Effect.succeed(issue?.milestone === null ? { already: 'no milestone' } : { to: null })
              : Effect.gen(function* () {
                  const typed = wanted.milestone ?? ''
                  const all = yield* ask('milestone', typed)
                  // A Linear milestone is its project's: of the project it goes in, where that's known.
                  const inProject =
                    project !== undefined && 'to' in project && project.to !== null
                      ? project.to.id
                      : project === undefined
                        ? issue?.project?.id
                        : undefined
                  // Never another project's: that would move the issue there, or be refused beside the project named.
                  const narrowed =
                    inProject === undefined ? all : all.filter((choice) => choice.in === undefined || choice.in === inProject)
                  const chosen = choiceNamed(narrowed, typed)
                  if (chosen === undefined)
                    return yield* Effect.fail(
                      `no milestone called “${typed.trim()}”${narrowed.length < all.length ? ' in its project' : ''}. It has: ${listed(narrowed.map((choice) => choice.name))}`,
                    )
                  return issue?.milestone != null && same(issue.milestone.name, chosen.name)
                    ? { already: `milestone ${chosen.name}` }
                    : { to: chosen }
                }),
          )
    const cycle = wanted.cycle === undefined ? undefined : yield* chosenOr('cycle', wanted.cycle, issue?.cycle)
    const parent =
      wanted.parent === undefined
        ? undefined
        : yield* one<ParentIssue | null>(
            'parent',
            wanted.parent === null
              ? Effect.succeed(issue?.parent === null ? { already: 'no parent' } : { to: null })
              : Effect.gen(function* () {
                  const typed = wanted.parent?.trim() ?? ''
                  // A link is read by its ref; a code host's #12 is in the issue's repository.
                  const linked = parseLink(typed)
                  const ref =
                    linked?.kind === 'issue'
                      ? linked.ref
                      : /^#?\d+$/.test(typed) && at.repository !== undefined
                        ? `${at.repository}#${typed.replace(/^#/, '')}`
                        : typed
                  const found = yield* tracker
                    .issue(ref)
                    .pipe(Effect.mapError((error) => `${name} hasn’t an issue ${typed} Althar can read: ${error.message}`))
                  if (issue !== undefined && found.id === issue.id) return yield* Effect.fail('an issue can’t be its own parent')
                  return issue?.parent != null && same(issue.parent.key, found.key)
                    ? { already: `part of ${found.key}` }
                    : { to: { id: found.id, ref: found.ref, key: found.key } }
                }),
          )
    const estimate =
      wanted.estimate === undefined
        ? undefined
        : yield* one<number | null>(
            'estimate',
            wanted.estimate !== null && (!Number.isFinite(wanted.estimate) || wanted.estimate < 0)
              ? Effect.fail(`an estimate is a number, 0 or more, not ${wanted.estimate}`)
              : Effect.succeed(
                  issue?.estimate === wanted.estimate ? { already: `estimate ${wanted.estimate ?? 'none'}` } : { to: wanted.estimate },
                ),
          )
    const type = wanted.type === undefined ? undefined : yield* chosenOr('type', wanted.type, issue?.type)
    const components =
      wanted.components === undefined
        ? undefined
        : yield* one<ReadonlyArray<Choice>>(
            'components',
            Effect.gen(function* () {
              const chosen = yield* Effect.forEach(wanted.components ?? [], (typed) => pick('components', typed, 'component'))
              const had = issue?.components ?? []
              return had.length === chosen.length && chosen.every((choice) => had.some((name) => same(name, choice.name)))
                ? { already: `components ${listed(had)}` }
                : { to: chosen }
            }),
          )
    const due =
      wanted.due === undefined
        ? undefined
        : yield* one<string | null>(
            'due',
            wanted.due !== null && !DAY.test(wanted.due.trim())
              ? Effect.fail(`a due date is a day, as 2026-11-30, not “${wanted.due}”`)
              : Effect.succeed(
                  (issue?.due ?? undefined) === (wanted.due?.trim() ?? null) && issue !== undefined
                    ? { already: wanted.due === null ? 'no due date' : `due ${wanted.due}` }
                    : { to: wanted.due?.trim() ?? null },
                ),
          )
    const title =
      wanted.title === undefined
        ? undefined
        : yield* one<string>(
            'title',
            wanted.title.trim() === ''
              ? Effect.fail('give it a title, not an empty one')
              : Effect.succeed(
                  issue !== undefined && wanted.title.trim() === issue.title
                    ? { already: 'its title as asked' }
                    : { to: wanted.title.trim() },
                ),
          )
    const description =
      wanted.description === undefined
        ? undefined
        : yield* one<string>(
            'description',
            Effect.succeed(
              issue !== undefined && wanted.description.trim() === issue.body.trim()
                ? { already: 'its description as asked' }
                : { to: wanted.description.trim() },
            ),
          )

    const read = {
      status,
      close,
      priority,
      assignee,
      labels,
      project,
      milestone,
      cycle,
      parent,
      estimate,
      type,
      components,
      due,
      title,
      description,
    }
    const change: Record<string, unknown> = {}
    const leftOff: Array<string> = []
    const already: Array<string> = []
    for (const [field, value] of Object.entries(read) as ReadonlyArray<[IssueField, Field<unknown> | undefined]>) {
      if (value === undefined) continue
      if ('to' in value) change[field] = value.to
      else if ('left' in value) leftOff.push(value.left)
      else already.push(value.already)
    }
    // A status set closes it its own way: closing as well is nothing more.
    if (change.status !== undefined) delete change.close
    return { change: change as IssueChange, left: leftOff, already }
  })

/** Whether a read change has anything left to make. */
export const anything = (change: IssueChange) => fieldsOf(change).length > 0

const PRIORITIES: ReadonlyArray<Priority> = ['urgent', 'high', 'medium', 'low', 'none']

/** A priority as an agent may say it: Low, low, "no priority", none. */
export const priorityOf = (said: string): Priority | undefined => {
  const word = said
    .trim()
    .toLowerCase()
    .replace(/\s+priority$/, '')
  return word === 'no' || word === 'no priority' ? 'none' : PRIORITIES.find((level) => level === word)
}

/** An issue's fields as a tool takes them, by the tracker's names. */
export const AskedFields = Schema.Struct({
  status: Schema.optional(Schema.String),
  priority: Schema.optional(Schema.String),
  assignee: Schema.optional(Schema.NullOr(Schema.String)),
  project: Schema.optional(Schema.NullOr(Schema.String)),
  milestone: Schema.optional(Schema.NullOr(Schema.String)),
  cycle: Schema.optional(Schema.NullOr(Schema.String)),
  parent: Schema.optional(Schema.NullOr(Schema.String)),
  estimate: Schema.optional(Schema.NullOr(Schema.Number)),
  type: Schema.optional(Schema.String),
  components: Schema.optional(Schema.Array(Schema.String)),
  due: Schema.optional(Schema.NullOr(Schema.String)),
})

/** What a tool was asked of an issue's fields, as `Wanted`; a priority that isn't one is refused. */
export const wantedFields = (asked: typeof AskedFields.Type): Effect.Effect<Wanted, ToolRefused> => {
  const priority = asked.priority === undefined ? undefined : priorityOf(asked.priority)
  if (asked.priority !== undefined && priority === undefined)
    return Effect.fail(new ToolRefused({ message: `A priority is one of urgent, high, medium, low or none, not “${asked.priority}”.` }))
  return Effect.succeed({
    ...(asked.status === undefined ? {} : { status: asked.status }),
    ...(priority === undefined ? {} : { priority }),
    ...(asked.assignee === undefined ? {} : { assignee: asked.assignee }),
    ...(asked.project === undefined ? {} : { project: asked.project }),
    ...(asked.milestone === undefined ? {} : { milestone: asked.milestone }),
    ...(asked.cycle === undefined ? {} : { cycle: asked.cycle }),
    ...(asked.parent === undefined ? {} : { parent: asked.parent }),
    ...(asked.estimate === undefined ? {} : { estimate: asked.estimate }),
    ...(asked.type === undefined ? {} : { type: asked.type }),
    ...(asked.components === undefined ? {} : { components: asked.components }),
    ...(asked.due === undefined ? {} : { due: asked.due }),
  })
}

/** The fields a tool takes, as JSON Schema, in the tracker's own names, which Althar reads against it. */
export const fieldSchema = {
  status: {
    type: 'string',
    description: 'Any of its tracker’s statuses, by name: In Review, Done, Canceled; on GitHub or GitLab, Open or Closed.',
  },
  priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
  assignee: {
    type: ['string', 'null'],
    description:
      'Someone to assign it to, by name, login or email; me for the person. Where it takes several (GitHub, GitLab, Trello) they are added to whoever has it; where it takes one (Linear, Jira), in their place. null for nobody.',
  },
  project: {
    type: ['string', 'null'],
    description: 'Its project, by name: Linear’s project, a GitHub project board. null for none.',
  },
  milestone: {
    type: ['string', 'null'],
    description: 'Its milestone, by name: Linear’s project milestone, GitHub’s or GitLab’s milestone, Jira’s fix version. null for none.',
  },
  cycle: { type: ['string', 'null'], description: 'Linear’s cycle, by name or number, or current or next. null for none.' },
  parent: {
    type: ['string', 'null'],
    description:
      'The issue it is part of, on the same tracker, by key or link: Linear’s parent, Jira’s parent or epic, GitHub’s parent issue.',
  },
  estimate: { type: ['number', 'null'], description: 'Linear’s estimate in points, GitLab’s weight.' },
  type: {
    type: 'string',
    description: 'Its kind: Jira’s issue type (Task, Bug, Story), GitHub’s issue type, GitLab’s (issue, incident, task).',
  },
  components: { type: 'array', items: { type: 'string' }, description: 'Jira’s components it is in, by name.' },
  due: { type: ['string', 'null'], description: 'When it is due, as a day: 2026-11-30. null for none.' },
} as const
