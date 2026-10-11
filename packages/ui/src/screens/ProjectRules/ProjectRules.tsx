import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'

import { CommandMatch, LimitPolicy, PermissionPolicy, RuleKind, RulePlace, TaskEnd } from '../../foundations/vocabulary'
import type { ChoiceWords } from '../../foundations/vocabularyText'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Menu, MenuCheckboxItem, MenuGroup, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { Popover } from '../../primitives/Popover/Popover'
import {
  AddCommand,
  Charter,
  CharterKey,
  type CharterKeyText,
  ChoiceWord,
  Clause,
  CommandToken,
  type CommandTokenText,
  NewCommand,
  NewCommandHint,
  type NewCommandHintProps,
  type NewCommandHintText,
  type NewCommandProps,
  RuleWord,
} from '../../setup/Charter/Charter'
import { NamingRule, type NamingRuleProps, type RepositoryTemplate, TemplateSources } from '../../setup/Conventions/Conventions'
import s from './ProjectRules.module.css'

/*
 * A project's rules, read as its charter: a few plain sentences in the
 * order a request meets them (what no project can change, what is never
 * allowed, what always asks, what goes ahead, and what happens to the
 * rest), then how a task ends and what happens when an account runs out.
 * Each kind of request Althar knows sits in one sentence, as an underlined
 * word that moves it to another; each command is code, taken out or added
 * where its sentence ends. Everything changes in place.
 */

/** Where a command rule can sit: never with the rest, which is for what no rule names. */
export type CommandPlace = RulePlace.Never | RulePlace.Ask | RulePlace.Allow

/** A command the project names, in the sentence for its place. */
export interface RuleCommand {
  id: string
  pattern: string
  match: CommandMatch
  place: CommandPlace
}

/** An agent with more than one account, and its accounts in the person's order. */
export interface AgentAccounts {
  id: string
  name: string
  accounts: readonly { id: string; label: string }[]
}

/** A kind of request, in the words each sentence needs. */
export interface KindWords {
  /** Its name, as its menu is headed. */
  name: string
  /** After "never": force push. */
  does: string
  /** After "before", "with" or "like": force pushing. */
  doing: string
  /** Commands it catches, as examples. */
  catches: readonly string[]
  /** What it never catches, after the examples. */
  except?: string
}

/** A value of a setting, as its menu offers it and as the sentence says it. */
interface Worded extends ChoiceWords {
  word: string
}

export interface ProjectRulesText {
  title: string
  lede: (project: string) => string
  key: Partial<CharterKeyText>
  /** Each sentence's word in the margin. */
  label: { always: string; never: string; ask: string; allow: string; rest: string; finished: string; limits: string }
  /** What no project can change. */
  fixed: string
  /** Who the sentences are about: first named, then again. */
  agents: string
  they: string
  /** How lists end: a, b and c; a, b or c. */
  and: string
  or: string
  kinds: Record<RuleKind, KindWords>
  catches: string
  /** The menu a kind's word opens: where it can sit. */
  place: Record<RulePlace, ChoiceWords>
  /** What sitting with the rest means, by what the rest gets. */
  withTheRest: (mode: string) => string
  never: { does: (subject: string) => string; andRuns: string; runs: (subject: string) => string; none: string }
  ask: { before: (subject: string) => string; andRunning: string; running: (subject: string) => string; none: string }
  allow: { with: (subject: string) => string; none: string }
  /** Under what always asks and what goes ahead while everything is allowed. */
  off: string
  /** The + at a sentence's end. */
  add: Record<CommandPlace, string>
  /** The field a command is typed in. */
  field: string
  /** Enter on an empty field. */
  typeFirst: string
  rest: { like: string; alone: string; colon: string; label: string; mode: Record<PermissionPolicy, Worded & { after: string }> }
  finished: {
    opens: string
    pushes: string
    onBranch: string
    named: string
    titled: string
    prTitled: string
    described: string
    label: string
    note: string
    end: Record<TaskEnd, Worded>
  }
  branches: { label: string; note: string; each: string }
  titles: { label: string; note: string; each: string }
  templates: { label: string; note: string; every: string; some: string; none: string }
  limits: { when: string; rotating: string; label: string; limit: Record<LimitPolicy, Worded> }
  accounts: {
    works: (agent: string) => string
    /** Between an agent's accounts, in the order work goes through them. */
    andThen: string
    label: (agent: string) => string
    uses: string
    rotation: string
    rotate: { first: ChoiceWords; next: ChoiceWords }
    note: string
  }
  token: Partial<CommandTokenText>
  hint: Partial<NewCommandHintText>
}

export const projectRulesText: ProjectRulesText = {
  title: 'Rules',
  lede: (project) => `For every task in ${project}, from its next request on`,
  key: {},
  label: {
    always: 'Always',
    never: 'Never',
    ask: 'Ask me',
    allow: 'Go ahead',
    rest: 'The rest',
    finished: 'Finished',
    limits: 'Limits',
  },
  fixed: 'No agent, in any project, reads your credentials or reaches the code host except through Althar.',
  agents: 'Agents',
  they: 'They',
  and: 'and',
  or: 'or',
  kinds: {
    [RuleKind.DefaultBranch]: {
      name: 'Pushing to the default branch',
      does: 'push to the default branch',
      doing: 'pushing to the default branch',
      catches: ['git push origin main', 'git push origin HEAD:main'],
      except: 'each repository’s own default',
    },
    [RuleKind.ForcePush]: {
      name: 'Force pushes',
      does: 'force push',
      doing: 'force pushing',
      catches: ['git push -f', 'git push --force-with-lease'],
    },
    [RuleKind.ManyBranches]: {
      name: 'Pushing every branch, tags, or a pattern of branches',
      does: 'push several branches or tags',
      doing: 'pushing several branches or tags',
      catches: ['git push --all', 'git push --tags', 'git push origin "feat/*"'],
    },
    [RuleKind.DeleteBranch]: {
      name: 'Deleting branches that aren’t the task’s',
      does: 'delete other branches',
      doing: 'deleting other branches',
      catches: ['git push origin --delete old-spike', 'git push --prune'],
      except: 'never the task’s own branch',
    },
    [RuleKind.Deploy]: {
      name: 'Deploying and publishing',
      does: 'deploy or publish',
      doing: 'deploying or publishing',
      catches: ['fly deploy', 'terraform apply', 'npm publish', 'make deploy'],
    },
    [RuleKind.Outside]: {
      name: 'Writing outside the task’s worktree',
      does: 'write outside the task',
      doing: 'writing outside the task',
      catches: ['cp .env ~/backup', 'git status > ~/.zshrc'],
    },
  },
  catches: 'Catches',
  place: {
    [RulePlace.Never]: { title: 'Never', note: 'Refused outright' },
    [RulePlace.Ask]: { title: 'Always ask me', note: 'Waits for you, whoever would answer' },
    [RulePlace.Allow]: { title: 'Always allowed', note: 'Goes ahead without asking' },
    [RulePlace.Rest]: { title: 'The rest', note: '' },
  },
  withTheRest: (mode) => `With the rest: ${mode}`,
  never: {
    does: (subject) => `${subject} never `,
    andRuns: ', and never run ',
    runs: (subject) => `${subject} never run `,
    none: 'Nothing is refused outright.',
  },
  ask: {
    before: (subject) => `${subject} ask you before `,
    andRunning: ', and before running ',
    running: (subject) => `${subject} ask you before running `,
    none: 'Nothing always waits for you.',
  },
  allow: {
    with: (subject) => `${subject} go ahead with `,
    none: 'Nothing goes ahead by a rule yet: a permission answered with “always allow” adds one here.',
  },
  off: 'Off while everything is allowed.',
  add: {
    [RulePlace.Never]: 'Add a command to Never',
    [RulePlace.Ask]: 'Add a command to Ask me',
    [RulePlace.Allow]: 'Add a command to Go ahead',
  },
  field: 'A command, as it starts',
  typeFirst: 'Type the command first.',
  rest: {
    like: 'Everything else, like ',
    alone: 'Everything else',
    colon: ': ',
    label: 'Everything else',
    mode: {
      [PermissionPolicy.Rules]: {
        word: 'allowed',
        title: 'Allowed',
        note: 'Goes ahead, unless Althar can’t read it',
        after: 'What Althar can’t read comes to you.',
      },
      [PermissionPolicy.Coordinator]: {
        word: 'the coordinator decides',
        title: 'The coordinator decides',
        note: 'Allows or refuses, with a reason; what it can’t settle comes to you',
        after: 'What it can’t settle, and what Althar can’t read, comes to you.',
      },
      [PermissionPolicy.Ask]: {
        word: 'ask me',
        title: 'Ask me',
        note: 'Reads and the task’s own files still go ahead. OpenCode has no sandbox, so each of its commands waits',
        after: 'Reads and the task’s own files still go ahead.',
      },
      [PermissionPolicy.AllowAll]: {
        word: 'allow everything',
        title: 'Allow everything',
        note: 'What asks and goes ahead above is off; only Never still holds',
        after: 'Only Never still holds, and while it names anything, what Althar can’t read is refused.',
      },
    },
  },
  finished: {
    opens: 'A finished task opens ',
    pushes: 'A finished task pushes ',
    onBranch: ', on a branch named ',
    named: ', named ',
    titled: ' and titled ',
    prTitled: '. A pull request opened from it is titled ',
    described: ', described in ',
    label: 'When a task is done',
    note: 'Merging stays yours. A repository on a host Althar doesn’t know ends on its branch',
    end: {
      [TaskEnd.DraftPr]: { word: 'a draft pull request', title: 'Open a draft pull request', note: 'Checks run on it; you mark it ready' },
      [TaskEnd.ReadyPr]: {
        word: 'a pull request for review',
        title: 'Open a pull request for review',
        note: 'Ready for review as soon as its last step passes',
      },
      [TaskEnd.PushOnly]: { word: 'its branch alone', title: 'Push the branch only', note: 'You open the pull request when you want one' },
    },
  },
  branches: { label: 'Branch names', note: '{key} is the issue’s key, {slug} the task’s name', each: 'as each repository says' },
  titles: { label: 'Pull request titles', note: '{key} is the issue’s key, {title} the task’s title', each: 'as each repository says' },
  templates: {
    label: 'Descriptions',
    note: 'Written in the repository’s pull request template, where it has one. The boxes are yours to tick',
    every: 'each repository’s template',
    some: 'each repository’s template, where it has one',
    none: 'Althar’s own words',
  },
  limits: {
    when: 'When an account runs out, the work ',
    rotating: 'When an account runs out, the work goes on with the agent’s next account, then ',
    label: 'When an account runs out',
    limit: {
      [LimitPolicy.Move]: {
        word: 'moves to the next agent free',
        title: 'Move the work to the next agent free',
        note: 'To the next agent signed in, in the order of your agents. It takes the work over from where it stands',
      },
      [LimitPolicy.Wait]: {
        word: 'waits for the reset',
        title: 'Wait for the reset',
        note: 'The step keeps its place and runs again at the reset',
      },
      [LimitPolicy.Ask]: { word: 'waits for you', title: 'Ask me', note: 'A card in the thread, with the agents that are free' },
    },
  },
  accounts: {
    works: (agent) => ` ${agent} works on `,
    andThen: ', then ',
    label: (agent) => `${agent} accounts this project may use`,
    uses: 'Works on',
    rotation: 'When one runs out',
    rotate: {
      first: { title: 'Stay on the first', note: 'Then the work does as the limit says' },
      next: { title: 'Go on with the next', note: 'The agent’s next account here, then as the limit says' },
    },
    note: 'In your order from Settings. Going on with the next holds for every agent in this project',
  },
  token: {},
  hint: {},
}

const KINDS = [
  RuleKind.DefaultBranch,
  RuleKind.ForcePush,
  RuleKind.ManyBranches,
  RuleKind.DeleteBranch,
  RuleKind.Deploy,
  RuleKind.Outside,
] as const
const PLACES = [RulePlace.Never, RulePlace.Ask, RulePlace.Allow, RulePlace.Rest] as const
const MODES = [PermissionPolicy.Rules, PermissionPolicy.Coordinator, PermissionPolicy.Ask, PermissionPolicy.AllowAll] as const
const ENDS = [TaskEnd.DraftPr, TaskEnd.ReadyPr, TaskEnd.PushOnly] as const
const LIMITS = [LimitPolicy.Move, LimitPolicy.Wait] as const

export type ProjectRulesProps = RootProps<
  'div',
  {
    project: string
    /** The title's rank; each sentence's margin word is one below. */
    headingLevel?: HeadingLevel
    /** What happens to what no rule keeps. */
    mode: PermissionPolicy
    onModeChange: (mode: PermissionPolicy) => void
    /** Where each kind of request sits: in one sentence only. */
    kinds: Readonly<Record<RuleKind, RulePlace>>
    onKindChange: (kind: RuleKind, place: RulePlace) => void
    /** The commands the project names, in its order. */
    commands: readonly RuleCommand[]
    onRemoveCommand: (id: string) => void
    /** Adds a command to a sentence; returns why it can't be, said under it, where the field stays. */
    onAddCommand: (place: CommandPlace, pattern: string, match: CommandMatch) => string | undefined
    end: TaskEnd
    onEndChange: (end: TaskEnd) => void
    /** How branches are named: the person's pattern over each repository's. */
    branches: Omit<NamingRuleProps, 'text'>
    /** How pull requests are titled, the same way. */
    titles: Omit<NamingRuleProps, 'text'>
    /** Each repository's pull request template. */
    templates: readonly RepositoryTemplate[]
    limit: LimitPolicy
    onLimitChange: (limit: LimitPolicy) => void
    /** The agents with more than one account. Without any, the accounts aren't said. */
    agentAccounts?: readonly AgentAccounts[]
    /** Whether work goes on with an agent's next account when one runs out. */
    rotate: boolean
    onRotateChange: (rotate: boolean) => void
    /** The accounts the project may use, by agent; an agent not named may use every one. */
    allowed: Readonly<Record<string, readonly string[]>>
    onAllowedChange: (agentId: string, accountIds: readonly string[]) => void
    text?: Partial<ProjectRulesText>
  }
>

/** The command being added: in which sentence, how it matches, and why it wasn't added. What is typed is kept apart (`Typed`). */
interface Draft {
  place: CommandPlace
  match: CommandMatch
  error: string | null
}

/**
 * What is typed for the command being added, kept apart from the screen so
 * a key redraws only the field and the line under it, not every sentence.
 */
interface Typed {
  get: () => string
  set: (value: string) => void
  subscribe: (listener: () => void) => () => void
}

const typedStore = (): Typed => {
  let value = ''
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const useTyped = (typed: Typed) => useSyncExternalStore(typed.subscribe, typed.get, typed.get)

/** The field for the command being added, as its sentence's last word. */
function DraftField({ typed, onType, ...rest }: Omit<NewCommandProps, 'value' | 'onChange'> & { typed: Typed; onType: () => void }) {
  return (
    <NewCommand
      {...rest}
      value={useTyped(typed)}
      onChange={(event) => {
        typed.set(event.target.value)
        onType()
      }}
    />
  )
}

/** Under the sentence: what the command typed so far holds for. */
function DraftHint({ typed, ...rest }: Omit<NewCommandHintProps, 'pattern'> & { typed: Typed }) {
  return <NewCommandHint {...rest} pattern={useTyped(typed)} />
}

/** Things in a list, as a sentence has them: a, b and c; with how the sentence ends kept on the line of the last. */
const join = (items: readonly ReactNode[], last: string, end?: ReactNode) =>
  items.map((item, index) => (
    <Fragment key={index}>
      {index > 0 && (index === items.length - 1 ? ` ${last} ` : ', ')}
      {end !== undefined && index === items.length - 1 ? (
        <span className={s.keep}>
          {item}
          {end}
        </span>
      ) : (
        item
      )}
    </Fragment>
  ))

/** What a pattern rule names, where it names one thing: the person's, or what every repository says alike. */
const nameShown = (rule: Omit<NamingRuleProps, 'text'>) => {
  if (rule.value !== null) return rule.value
  const patterns = [...new Set(rule.repositories.map((repository) => repository.found?.pattern ?? rule.fallback))]
  return patterns.length <= 1 ? (patterns[0] ?? rule.fallback) : null
}

/** A project's rules as a few sentences, each changed in place. */
export function ProjectRules({
  project,
  headingLevel = 1,
  mode,
  onModeChange,
  kinds,
  onKindChange,
  commands,
  onRemoveCommand,
  onAddCommand,
  end,
  onEndChange,
  branches,
  titles,
  templates,
  limit,
  onLimitChange,
  agentAccounts = [],
  rotate,
  onRotateChange,
  allowed,
  onAllowedChange,
  text,
  className,
  ...rest
}: ProjectRulesProps) {
  const t = { ...projectRulesText, ...text }
  const sub: HeadingLevel = headingLevel >= 6 ? 6 : ((headingLevel + 1) as HeadingLevel)
  const allowAll = mode === PermissionPolicy.AllowAll
  const modeWords = t.rest.mode[mode]

  const [draft, setDraft] = useState<Draft | null>(null)
  const [typed] = useState(typedStore)
  const field = useRef<HTMLInputElement>(null)
  const noteId = useId()
  const errorId = useId()
  const clauses = useRef<Partial<Record<CommandPlace, HTMLLIElement | null>>>({})
  // Where focus goes once the page has what changed: back to a sentence's +, or to the next command's ×.
  const refocus = useRef<{ place: CommandPlace; index: number | null } | null>(null)
  useEffect(() => {
    const to = refocus.current
    if (to === null) return
    const clause = clauses.current[to.place]
    if (clause === null || clause === undefined) return
    refocus.current = null
    const removes = clause.querySelectorAll<HTMLElement>('[data-remove]')
    const next = to.index === null ? undefined : removes[Math.min(to.index, removes.length - 1)]
    ;(next ?? clause.querySelector<HTMLElement>('[data-add]'))?.focus()
  })
  // The field starts with focus as it opens.
  const opened = draft?.place
  useEffect(() => {
    if (opened !== undefined) field.current?.focus()
  }, [opened])

  const leave = () => {
    if (draft !== null) refocus.current = { place: draft.place, index: null }
    setDraft(null)
  }
  const open = (place: CommandPlace) => {
    typed.set('')
    setDraft({ place, match: CommandMatch.Prefix, error: null })
  }
  const submit = () => {
    if (draft === null) return
    const pattern = typed.get().trim()
    if (pattern === '') return setDraft({ ...draft, error: t.typeFirst })
    const problem = onAddCommand(draft.place, pattern, draft.match)
    if (problem !== undefined) return setDraft({ ...draft, error: problem })
    leave()
  }
  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      leave()
    }
  }

  const kindWord = (kind: RuleKind, as: 'does' | 'doing') => {
    const words = t.kinds[kind]
    return (
      <ChoiceWord
        key={kind}
        word={words[as]}
        label={words.name}
        value={kinds[kind]}
        onChange={(place) => onKindChange(kind, place)}
        options={PLACES.map((place) => ({
          value: place,
          title: t.place[place].title,
          note: place === RulePlace.Rest ? t.withTheRest(modeWords.word) : t.place[place].note,
        }))}
        note={
          <>
            {t.catches}{' '}
            {join(
              words.catches.map((each) => <code key={each}>{each}</code>),
              t.and,
            )}
            {words.except === undefined ? '' : `; ${words.except}`}
          </>
        }
      />
    )
  }
  const kindsAt = (place: RulePlace) => KINDS.filter((kind) => kinds[kind] === place)

  /** A sentence's commands, with the one being added at its end. */
  const commandsAt = (place: CommandPlace) => {
    const named = commands.filter((command) => command.place === place)
    const tokens: ReactNode[] = named.map((command, index) => (
      <CommandToken
        key={command.id}
        pattern={command.pattern}
        match={command.match}
        text={t.token}
        onRemove={() => {
          refocus.current = { place, index }
          onRemoveCommand(command.id)
        }}
      />
    ))
    if (draft?.place === place)
      tokens.push(
        <DraftField
          key="new"
          ref={field}
          typed={typed}
          aria-label={t.field}
          aria-describedby={[noteId, draft.error === null ? '' : errorId].filter(Boolean).join(' ')}
          invalid={draft.error !== null}
          // Typing again takes the reason back: it may no longer hold.
          onType={() => {
            if (draft.error !== null) setDraft({ ...draft, error: null })
          }}
          onKeyDown={onFieldKey}
        />,
      )
    return tokens
  }
  /** The + at a sentence's end, or, while one is added there, how it matches under it. */
  const adding = (place: CommandPlace) => (draft?.place === place ? null : <AddCommand label={t.add[place]} onClick={() => open(place)} />)
  /** How a sentence of commands ends: its full stop, and its +. */
  const ending = (place: CommandPlace) => <>.{adding(place)}</>
  const hint = (place: CommandPlace) =>
    draft?.place === place ? (
      <DraftHint
        typed={typed}
        match={draft.match}
        onMatchChange={(match) => {
          setDraft({ ...draft, match, error: null })
          // Back to the field once the choice has closed, to go on typing.
          setTimeout(() => field.current?.focus(), 0)
        }}
        error={draft.error}
        errorId={errorId}
        noteId={noteId}
        text={t.hint}
      />
    ) : null
  const clauseRef = (place: CommandPlace) => (element: HTMLLIElement | null) => {
    clauses.current[place] = element
  }

  // Who each sentence is about: agents, the first time they are named.
  const neverKinds = kindsAt(RulePlace.Never).map((kind) => kindWord(kind, 'does'))
  const neverCommands = commandsAt(RulePlace.Never)
  const neverNames = neverKinds.length > 0 || neverCommands.length > 0
  const askKinds = kindsAt(RulePlace.Ask).map((kind) => kindWord(kind, 'doing'))
  const askCommands = commandsAt(RulePlace.Ask)
  const askNames = askKinds.length > 0 || askCommands.length > 0
  const goAhead = [...kindsAt(RulePlace.Allow).map((kind) => kindWord(kind, 'doing')), ...commandsAt(RulePlace.Allow)]
  const restKinds = kindsAt(RulePlace.Rest).map((kind) => kindWord(kind, 'doing'))

  const branchName = nameShown(branches)
  const titleName = nameShown(titles)
  const withTemplate = templates.filter((repository) => repository.path !== null).length
  const templateWord = withTemplate === 0 ? t.templates.none : withTemplate === templates.length ? t.templates.every : t.templates.some
  const endWords = t.finished.end[end]
  const pushOnly = end === TaskEnd.PushOnly
  const rotating = rotate && agentAccounts.length > 0

  return (
    <div className={cx(s.rules, className)} {...rest}>
      <header className={s.head}>
        <div className={s.headText}>
          <Heading level={headingLevel} className={s.title}>
            {t.title}
          </Heading>
          <p className={s.lede}>{t.lede(project)}</p>
        </div>
        <CharterKey text={t.key} className={s.key} />
      </header>

      <Charter>
        <Clause label={t.label.always} headingLevel={sub} fixed>
          {t.fixed}
        </Clause>

        <Clause label={t.label.never} headingLevel={sub} ref={clauseRef(RulePlace.Never)} below={hint(RulePlace.Never)}>
          {neverKinds.length > 0 && neverCommands.length > 0 ? (
            <>
              {t.never.does(t.agents)}
              {join(neverKinds, t.or)}
              {t.never.andRuns}
              {join(neverCommands, t.or, ending(RulePlace.Never))}
            </>
          ) : neverKinds.length > 0 ? (
            <>
              {t.never.does(t.agents)}
              {join(neverKinds, t.or, ending(RulePlace.Never))}
            </>
          ) : neverCommands.length > 0 ? (
            <>
              {t.never.runs(t.agents)}
              {join(neverCommands, t.or, ending(RulePlace.Never))}
            </>
          ) : (
            <>
              {t.never.none}
              {adding(RulePlace.Never)}
            </>
          )}
        </Clause>

        <Clause
          label={t.label.ask}
          headingLevel={sub}
          ref={clauseRef(RulePlace.Ask)}
          below={hint(RulePlace.Ask)}
          {...(allowAll ? { off: t.off } : {})}
        >
          {askKinds.length > 0 && askCommands.length > 0 ? (
            <>
              {t.ask.before(neverNames ? t.they : t.agents)}
              {join(askKinds, t.or)}
              {t.ask.andRunning}
              {join(askCommands, t.or, ending(RulePlace.Ask))}
            </>
          ) : askKinds.length > 0 ? (
            <>
              {t.ask.before(neverNames ? t.they : t.agents)}
              {join(askKinds, t.or, ending(RulePlace.Ask))}
            </>
          ) : askCommands.length > 0 ? (
            <>
              {t.ask.running(neverNames ? t.they : t.agents)}
              {join(askCommands, t.or, ending(RulePlace.Ask))}
            </>
          ) : (
            <>
              {t.ask.none}
              {adding(RulePlace.Ask)}
            </>
          )}
        </Clause>

        <Clause
          label={t.label.allow}
          headingLevel={sub}
          ref={clauseRef(RulePlace.Allow)}
          below={hint(RulePlace.Allow)}
          {...(allowAll ? { off: t.off } : {})}
        >
          {goAhead.length > 0 ? (
            <>
              {t.allow.with(neverNames || askNames ? t.they : t.agents)}
              {join(goAhead, t.and, ending(RulePlace.Allow))}
            </>
          ) : (
            <>
              {t.allow.none}
              {adding(RulePlace.Allow)}
            </>
          )}
        </Clause>

        <Clause label={t.label.rest} headingLevel={sub}>
          {restKinds.length > 0 ? (
            <>
              {t.rest.like}
              {join(restKinds, t.and)}
            </>
          ) : (
            t.rest.alone
          )}
          {t.rest.colon}
          <ChoiceWord
            word={modeWords.word}
            label={t.rest.label}
            value={mode}
            onChange={onModeChange}
            options={MODES.map((value) => ({ value, title: t.rest.mode[value].title, note: t.rest.mode[value].note }))}
          />
          . {modeWords.after}
        </Clause>

        <Clause label={t.label.finished} headingLevel={sub} apart>
          {pushOnly ? t.finished.pushes : t.finished.opens}
          <ChoiceWord
            word={endWords.word}
            label={t.finished.label}
            value={end}
            onChange={onEndChange}
            note={t.finished.note}
            options={ENDS.map((value) => ({ value, title: t.finished.end[value].title, note: t.finished.end[value].note }))}
          />
          {pushOnly ? t.finished.named : t.finished.onBranch}
          <NameWord rule={branches} shown={branchName} each={t.branches.each} label={t.branches.label} note={t.branches.note} />
          {pushOnly ? t.finished.prTitled : t.finished.titled}
          <NameWord rule={titles} shown={titleName} each={t.titles.each} label={t.titles.label} note={t.titles.note} />
          {t.finished.described}
          <Popover label={t.templates.label} width={380} trigger={<RuleWord>{templateWord}</RuleWord>}>
            <span className={s.popLabel}>{t.templates.label}</span>
            <span className={s.popNote}>{t.templates.note}</span>
            <TemplateSources repositories={templates} />
          </Popover>
          .
        </Clause>

        <Clause label={t.label.limits} headingLevel={sub}>
          {rotating ? t.limits.rotating : t.limits.when}
          <ChoiceWord
            word={t.limits.limit[limit].word}
            label={t.limits.label}
            value={limit}
            onChange={onLimitChange}
            options={LIMITS.map((value) => ({ value, title: t.limits.limit[value].title, note: t.limits.limit[value].note }))}
          />
          .
          {agentAccounts.map((agent) => {
            const on = allowed[agent.id] ?? agent.accounts.map((account) => account.id)
            const used = agent.accounts.filter((account) => on.includes(account.id))
            const shown = rotate ? used : used.slice(0, 1)
            return (
              <Fragment key={agent.id}>
                {t.accounts.works(agent.name)}
                <Menu
                  label={t.accounts.label(agent.name)}
                  width={300}
                  note={t.accounts.note}
                  trigger={<RuleWord>{shown.map((account) => account.label).join(t.accounts.andThen)}</RuleWord>}
                >
                  <MenuGroup label={t.accounts.uses}>
                    {agent.accounts.map((account) => {
                      const checked = on.includes(account.id)
                      return (
                        <MenuCheckboxItem
                          key={account.id}
                          checked={checked}
                          // The last one on stays on: work has to run on something.
                          disabled={checked && on.length === 1}
                          keepOpen
                          onCheckedChange={(now) =>
                            onAllowedChange(
                              agent.id,
                              agent.accounts.map((each) => each.id).filter((id) => (id === account.id ? now : on.includes(id))),
                            )
                          }
                        >
                          {account.label}
                        </MenuCheckboxItem>
                      )
                    })}
                  </MenuGroup>
                  <MenuSeparator />
                  <MenuRadioGroup
                    label={t.accounts.rotation}
                    value={rotate ? 'next' : 'first'}
                    onChange={(value) => onRotateChange(value === 'next')}
                  >
                    <MenuRadioItem value="first" description={t.accounts.rotate.first.note}>
                      {t.accounts.rotate.first.title}
                    </MenuRadioItem>
                    <MenuRadioItem value="next" description={t.accounts.rotate.next.note}>
                      {t.accounts.rotate.next.title}
                    </MenuRadioItem>
                  </MenuRadioGroup>
                </Menu>
                .
              </Fragment>
            )
          })}
        </Clause>
      </Charter>
    </div>
  )
}

/**
 * A name as the sentence has it: what the pattern makes for an example
 * task, in the code's type; or, where the repositories each say their own,
 * that. It opens the pattern, with where each repository's comes from.
 */
function NameWord({
  rule,
  shown,
  each,
  label,
  note,
}: {
  rule: Omit<NamingRuleProps, 'text'>
  shown: string | null
  each: string
  label: string
  note: string
}) {
  return (
    <Popover
      label={label}
      width={400}
      trigger={<RuleWord mono={shown !== null}>{shown === null ? each : rule.exampleOf(shown)}</RuleWord>}
      // A pattern typed and not yet given goes in as the popover closes on a click outside, as leaving the field does.
      onInteractOutside={() => blurInside()}
    >
      <span className={s.popLabel}>{label}</span>
      <span className={s.popNote}>{note}</span>
      <NamingRule {...rule} text={{ field: label }} />
    </Popover>
  )
}

/** Leaves the field that has focus, so what it holds is given. */
const blurInside = () => {
  const active = document.activeElement
  if (active instanceof HTMLInputElement) active.blur()
}
