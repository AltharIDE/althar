import {
  type AgentStatus,
  type CommandRule,
  commandStartOf,
  fillPattern,
  hostOf,
  type ProjectRulesView,
  runsOutside,
  type SandboxEdits,
} from '@althar/contracts'
import { CommandMatch, LimitPolicy, PermissionPolicy, RuleKind, RulePlace, TaskEnd, unreachable } from '@althar/ui'
import { type CommandPlace, ProjectRules, type RestMode, type RuleCommand, type SandboxList } from '@althar/ui/screens'

import { PartPending, pendingText } from '../../shared/Pending'
import { HEADING } from '../projectSettings/sections'
import s from './Rules.module.css'
import type { RulesModel } from './useRules'

/*
 * A project's rules (ADR-013), a section of its settings, as the kit's
 * charter: what agents are never allowed, what always asks, what goes ahead
 * (ADR-018) and what happens to the rest, in the order a request meets
 * them; how a task ends and is named; and what a usage limit does, with the
 * accounts work runs on. A kind of request sits in one sentence: moving it
 * writes it on one list and takes it off the others. The section names
 * them, so the charter has only its key above it.
 */

export const text = {
  /** Why a command can't go ahead: a sentence that comes first has it. */
  onOtherList: (pattern: string, list: 'ask' | 'never') => {
    const named = list === 'never' ? 'Never' : 'Ask me'
    return `“${pattern}” is under ${named}, which comes first, so nothing changed. Take it out there first.`
  },
  /** Why what was typed can't be a host. */
  notAHost: (typed: string) => `“${typed.trim()}” isn’t a host. Type its name, such as registry.npmjs.org.`,
  /** Why a wildcard can't be a host the sandbox reaches. */
  wildHost:
    'Name each host on its own, such as pkgs.example.com: the rules check every host a lead reaches, and can’t check every host under a *.',
  /** Enter on nothing but spaces or a lone *. */
  noCommand: 'Type how the command starts first.',
  /** A command Claude Code keeps in its sandbox whatever the list says. */
  bunStays:
    'Claude Code runs a command that starts with bun in its sandbox whatever this list says. Add what it runs instead, such as node scripts/e2e.ts.',
  /** The task names are shown for: its key from the project's name. */
  example: (project: string) => {
    const letters = project
      .replace(/[^a-z]/gi, '')
      .slice(0, 3)
      .toUpperCase()
    return { key: `${letters.length < 2 ? 'PROJ' : letters}-128`, slug: 'fix-login', title: 'Fix login' }
  },
  /** The modes as a new project offers them, before its rules are read as sentences. */
  permission: {
    [PermissionPolicy.Rules]: {
      title: 'Allow, except what you keep',
      note: 'Agents carry on without stopping. What “Always ask me” lists waits for you; what “Never” lists is refused.',
    },
    [PermissionPolicy.Coordinator]: {
      title: 'The coordinator decides',
      note: 'The coordinator allows or denies requests within the project’s rules, with a reason. Anything it can’t decide waits for you.',
    },
    [PermissionPolicy.Ask]: {
      title: 'Ask me',
      note: 'What agents ask to do beyond the task’s own files waits for you. OpenCode has no sandbox, so each of its commands waits too.',
    },
    [PermissionPolicy.AllowAll]: {
      title: 'Allow everything',
      note: 'Nothing waits for you. What “Never” lists is still refused, and, while it lists anything, a command Althar can’t read.',
    },
  },
}

const KINDS = [
  RuleKind.DefaultBranch,
  RuleKind.ForcePush,
  RuleKind.ManyBranches,
  RuleKind.DeleteBranch,
  RuleKind.Deploy,
  RuleKind.Outside,
] as const

const modeOf = (permissions: ProjectRulesView['permissions']): RestMode => {
  switch (permissions) {
    case 'rules':
      return PermissionPolicy.Rules
    case 'coordinator':
      return PermissionPolicy.Coordinator
    case 'ask':
      return PermissionPolicy.Ask
  }
}
const permissionsOf = (mode: RestMode): ProjectRulesView['permissions'] => {
  switch (mode) {
    case PermissionPolicy.Rules:
      return 'rules'
    case PermissionPolicy.Coordinator:
      return 'coordinator'
    case PermissionPolicy.Ask:
      return 'ask'
    default:
      return unreachable(mode)
  }
}

const limitOf = (usageLimit: ProjectRulesView['usageLimit']): LimitPolicy => {
  switch (usageLimit) {
    case 'move':
      return LimitPolicy.Move
    case 'wait':
      return LimitPolicy.Wait
    case 'ask':
      return LimitPolicy.Ask
  }
}
const usageLimitOf = (limit: LimitPolicy): ProjectRulesView['usageLimit'] => {
  switch (limit) {
    case LimitPolicy.Move:
      return 'move'
    case LimitPolicy.Wait:
      return 'wait'
    case LimitPolicy.Ask:
      return 'ask'
    default:
      return unreachable(limit)
  }
}

/** How a task ends: a draft where the project hasn't said, as the runtime does where the host is connected. */
export const endOf = (end: ProjectRulesView['end']): TaskEnd => {
  switch (end) {
    case null:
    case 'draft':
      return TaskEnd.DraftPr
    case 'ready':
      return TaskEnd.ReadyPr
    case 'none':
      return TaskEnd.PushOnly
  }
}
const endsAs = (end: TaskEnd): NonNullable<ProjectRulesView['end']> => {
  switch (end) {
    case TaskEnd.DraftPr:
      return 'draft'
    case TaskEnd.ReadyPr:
      return 'ready'
    case TaskEnd.PushOnly:
      return 'none'
    default:
      return unreachable(end)
  }
}

/** Where a kind sits: the first of the lists a request meets that has it, as the runtime reads them. */
const placeOf = (rules: ProjectRulesView, kind: RuleKind): RulePlace =>
  rules.never.includes(kind)
    ? RulePlace.Never
    : rules.alwaysAsk.includes(kind)
      ? RulePlace.Ask
      : rules.alwaysAllow.includes(kind)
        ? RulePlace.Allow
        : RulePlace.Rest

/** Every kind on the one list of where it sits, with one moved: the three lists, written whole. */
export const listsWith = (rules: ProjectRulesView, moved: RuleKind, to: RulePlace) => {
  const at = (kind: RuleKind) => (kind === moved ? to : placeOf(rules, kind))
  return {
    never: KINDS.filter((kind) => at(kind) === RulePlace.Never),
    alwaysAsk: KINDS.filter((kind) => at(kind) === RulePlace.Ask),
    alwaysAllow: KINDS.filter((kind) => at(kind) === RulePlace.Allow),
  }
}

const placeOfDecision = (decision: CommandRule['decision']): CommandPlace => {
  switch (decision) {
    case 'never':
      return RulePlace.Never
    case 'ask':
      return RulePlace.Ask
    case 'allow':
      return RulePlace.Allow
  }
}
const decisionOf = (place: CommandPlace): CommandRule['decision'] => {
  switch (place) {
    case RulePlace.Never:
      return 'never'
    case RulePlace.Ask:
      return 'ask'
    case RulePlace.Allow:
      return 'allow'
    default:
      return unreachable(place)
  }
}
const isExact = (rule: CommandRule) => rule.match === 'exact'

/** A command rule's id on the page: its place, how it matches, and its words. */
const commandId = (rule: CommandRule) => `${rule.decision}:${rule.match ?? 'prefix'}:${rule.pattern}`

const commandsOf = (rules: ProjectRulesView): RuleCommand[] =>
  rules.commands.map((rule) => ({
    id: commandId(rule),
    pattern: rule.pattern,
    match: isExact(rule) ? CommandMatch.Exact : CommandMatch.Prefix,
    place: placeOfDecision(rule.decision),
  }))

/**
 * Adds a command to a sentence, once, in place of the same words in another;
 * or why it can't be: going ahead never takes the place of what always asks
 * or is never allowed, which come first. A rule by how a command starts
 * keeps its words with single spaces; one for the whole line keeps it as is.
 */
export const withCommand = (
  rules: ProjectRulesView,
  place: CommandPlace,
  typed: string,
  match: CommandMatch,
): { readonly commands: ReadonlyArray<CommandRule> } | { readonly problem: string } | null => {
  const exact = match === CommandMatch.Exact
  const pattern = exact ? typed.trim() : typed.trim().replace(/\s+/g, ' ')
  const decision = decisionOf(place)
  const same = rules.commands.filter((rule) => rule.pattern === pattern && isExact(rule) === exact)
  if (same.some((rule) => rule.decision === decision)) return null
  const held = decision === 'allow' ? same.find((rule) => rule.decision !== 'allow') : undefined
  if (held !== undefined && held.decision !== 'allow') return { problem: text.onOtherList(pattern, held.decision) }
  return {
    commands: [
      ...rules.commands.filter((rule) => !same.includes(rule)),
      { pattern, decision, ...(exact ? { match: 'exact' as const } : {}) },
    ],
  }
}

/**
 * A sandbox list's edits with one value added or taken out: added, it is no
 * longer taken out; taken out, it is no longer added, and stays out of what
 * Althar works out later.
 */
export const sandboxEdited = (edits: SandboxEdits, value: string, to: 'add' | 'remove'): SandboxEdits =>
  to === 'add'
    ? {
        added: edits.added.includes(value) ? edits.added : [...edits.added, value],
        removed: edits.removed.filter((each) => each !== value),
      }
    : {
        added: edits.added.filter((each) => each !== value),
        removed: edits.removed.includes(value) ? edits.removed : [...edits.removed, value],
      }

/** What was typed for a sandbox list, as the list keeps it; or why it can't be. */
const sandboxEntryOf = (list: SandboxList, typed: string): { readonly value: string } | { readonly problem: string } => {
  const value = list === 'hosts' ? hostOf(typed) : commandStartOf(typed)
  if (value !== null) return { value }
  if (list === 'commands') return { problem: runsOutside(typed) ? text.noCommand : text.bunStays }
  return { problem: typed.includes('*') ? text.wildHost : text.notAHost(typed) }
}

/** Althar's own patterns, where a repository's docs say nothing and the person set none. */
export const OWN = { branch: 'althar/{key}-{slug}', title: '{title}' } as const

/** What each repository's docs say of a kind of name. */
const namingOf = (rules: ProjectRulesView, kind: 'branch' | 'title') =>
  rules.conventions.map((repository) => ({ id: repository.repository, name: repository.repository, found: repository[kind] }))

/** The agents with more than one account, as the accounts are said. */
export const agentAccountsOf = (agents: ReadonlyArray<AgentStatus>) =>
  agents
    .filter((agent) => agent.accounts.length > 1)
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      accounts: agent.accounts.map((account) => ({ id: account.id, label: account.name })),
    }))

export function RulesSection({ model }: { model: RulesModel }) {
  const { rules } = model
  const project = model.project ?? ''
  const example = text.example(project)
  return (
    <>
      {model.error !== null && (
        <p className={s.error} role="alert">
          {model.error}
        </p>
      )}
      {rules === null ? (
        <PartPending label={pendingText.page} />
      ) : (
        <ProjectRules
          project={project}
          titled={false}
          headingLevel={HEADING.title}
          mode={modeOf(rules.permissions)}
          onModeChange={(mode) => model.change({ permissions: permissionsOf(mode) })}
          allowAll={rules.allowEverything}
          onAllowAllChange={(allowEverything) => model.change({ allowEverything })}
          kinds={Object.fromEntries(KINDS.map((kind) => [kind, placeOf(rules, kind)])) as Record<RuleKind, RulePlace>}
          onKindChange={(kind, place) => model.change((now) => listsWith(now, kind, place))}
          commands={commandsOf(rules)}
          onRemoveCommand={(id) => model.change((now) => ({ commands: now.commands.filter((rule) => commandId(rule) !== id) }))}
          onAddCommand={(place, pattern, match) => {
            // Said at once against the rules shown; kept against the rules as they are when it is saved.
            const added = withCommand(rules, place, pattern, match)
            if (added === null) return undefined
            if ('problem' in added) return added.problem
            model.change((now) => {
              const again = withCommand(now, place, pattern, match)
              return again === null || 'problem' in again ? null : { commands: again.commands }
            })
            return undefined
          }}
          end={endOf(rules.end)}
          onEndChange={(end) => model.change({ end: endsAs(end) })}
          branches={{
            value: rules.branchPattern,
            onChange: (pattern) => model.setPattern('branch', pattern),
            error: model.patternErrors.branch,
            exampleOf: (pattern) => fillPattern(pattern, example),
            fallback: OWN.branch,
            repositories: namingOf(rules, 'branch'),
          }}
          titles={{
            value: rules.titlePattern,
            onChange: (pattern) => model.setPattern('title', pattern),
            error: model.patternErrors.title,
            exampleOf: (pattern) => fillPattern(pattern, example),
            fallback: OWN.title,
            repositories: namingOf(rules, 'title'),
          }}
          templates={rules.conventions.map((repository) => ({
            id: repository.repository,
            name: repository.repository,
            path: repository.template,
          }))}
          limit={limitOf(rules.usageLimit)}
          onLimitChange={(limit) => model.change({ usageLimit: usageLimitOf(limit) })}
          agentAccounts={agentAccountsOf(model.agents)}
          rotate={rules.rotateAccounts}
          onRotateChange={(rotateAccounts) => model.change({ rotateAccounts })}
          allowed={rules.onlyAccounts ?? {}}
          onAllowedChange={(agentId, ids) => {
            const every = model.agents.find((agent) => agent.id === agentId)?.accounts.length ?? 0
            model.change((now) => {
              const { [agentId]: _, ...others } = now.onlyAccounts ?? {}
              const only = ids.length === every ? others : { ...others, [agentId]: ids }
              return { onlyAccounts: Object.keys(only).length === 0 ? null : only }
            })
          }}
          sandbox={{
            commands: rules.sandbox.commands,
            hosts: rules.sandbox.hosts,
            onAdd: (list, typed) => {
              const entry = sandboxEntryOf(list, typed)
              if ('problem' in entry) return entry.problem
              if (rules.sandbox[list].includes(entry.value)) return undefined
              model.change((now) => ({ sandbox: { [list]: sandboxEdited(now.sandbox.edits[list], entry.value, 'add') } }))
              return undefined
            },
            onRemove: (list, value) =>
              model.change((now) => ({ sandbox: { [list]: sandboxEdited(now.sandbox.edits[list], value, 'remove') } })),
          }}
        />
      )}
    </>
  )
}
