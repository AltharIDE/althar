import { type AgentStatus, type CommandRule, fillPattern, type ProjectRulesView, type RuleKind } from '@althar/contracts'
import { BackCrumb, LimitPolicy, PermissionPolicy, TaskEnd } from '@althar/ui'
import { ProjectRules, projectRulesText } from '@althar/ui/screens'

import { PartPending, pendingText } from '../../shared/Pending'
import s from './Rules.module.css'
import type { RulesModel } from './useRules'

/*
 * A project's rules (ADR-013): what happens to what agents ask to do beyond
 * their sandbox, what always waits for the person and what is never
 * allowed, how a task ends, how its branches and pull requests are named
 * and described, what a usage limit does, and which accounts work runs on.
 * The kit's screen, with only what Althar does today.
 */

export const text = {
  back: 'Back to the project',
  /** Each kind of request the rules can keep, as the lists say it. */
  kinds: {
    'default-branch': 'Pushing to the default branch',
    'force-push': 'Force pushes',
    'many-branches': 'Pushing every branch, tags, or a pattern of branches',
    'delete-branch': 'Deleting branches that aren’t the task’s',
    deploy: 'Deploying and publishing',
    outside: 'Writing outside the task’s worktree',
  } satisfies Record<RuleKind, string>,
  command: (pattern: string) => `Running ${pattern}`,
  /** The task a pattern's example is made for. */
  example: { key: 'PROJ-123', slug: 'fix-login', title: 'Fix login' },
  /** The kit's words where Althar does less, or says it more exactly. */
  screen: {
    lede: 'For every task in this project, from the next request on.',
    permissions: { label: 'Permissions', note: 'What agents ask to do beyond their sandbox: the network, or writing outside the task' },
    permission: {
      ...projectRulesText.permission,
      [PermissionPolicy.Ask]: {
        title: 'Ask me',
        note: 'What agents ask to do beyond the task’s own files waits for you. OpenCode has no sandbox, so each of its commands waits too.',
      },
      [PermissionPolicy.AllowAll]: {
        title: 'Allow everything',
        note: 'Nothing waits for you. What “Never” lists is still refused, and, while it lists anything, a command Althar can’t read.',
      },
    },
    foot: '',
    endOption: {
      [TaskEnd.DraftPr]: { title: 'Open a draft PR', note: 'Checks run on it; you mark it ready.' },
      [TaskEnd.ReadyPr]: { title: 'Open a PR for review', note: 'Ready for review as soon as its last step passes.' },
      [TaskEnd.PushOnly]: { title: 'Push the branch only', note: 'You open the pull request when you want one.' },
    },
    limits: { label: 'Usage limits', note: 'When an agent’s account runs out, for the lead and every step on it' },
    limit: {
      [LimitPolicy.Move]: {
        title: 'Move the work to the next agent free',
        note: 'To the next agent signed in on a plan, in the order of your agents. It takes the work over from where it stands.',
      },
      [LimitPolicy.Wait]: { title: 'Wait for the reset', note: 'The step keeps its place and runs again at the reset.' },
      [LimitPolicy.Ask]: { title: 'Ask me', note: 'A card in the thread, with the agents that are free.' },
    },
  },
}

const KINDS = Object.keys(text.kinds) as ReadonlyArray<RuleKind>

const toEnd = { draft: TaskEnd.DraftPr, ready: TaskEnd.ReadyPr, none: TaskEnd.PushOnly } as const

const toPolicy = { rules: PermissionPolicy.Rules, ask: PermissionPolicy.Ask, allow: PermissionPolicy.AllowAll } as const
const fromPolicy = (policy: PermissionPolicy): ProjectRulesView['permissions'] =>
  policy === PermissionPolicy.Ask ? 'ask' : policy === PermissionPolicy.AllowAll ? 'allow' : 'rules'

/** A command rule's id in the lists. */
const commandId = (pattern: string) => `command:${pattern}`

/** A list's items: the kinds, then the commands the person named for it. */
const itemsOf = (commands: ReadonlyArray<CommandRule>, decision: CommandRule['decision']) => [
  ...KINDS.map((kind) => ({ id: kind, label: text.kinds[kind] })),
  ...commands
    .filter((rule) => rule.decision === decision)
    .map((rule) => ({ id: commandId(rule.pattern), label: text.command(rule.pattern) })),
]

/** What a list being changed means for the rules: its kinds, and its commands, those unticked gone. */
const listChange = (rules: ProjectRulesView, decision: CommandRule['decision'], ids: ReadonlyArray<string>) => ({
  kinds: KINDS.filter((kind) => ids.includes(kind)),
  commands: rules.commands.filter((rule) => rule.decision !== decision || ids.includes(commandId(rule.pattern))),
})

/** Adds a command to a list, once. */
const withCommand = (rules: ProjectRulesView, pattern: string, decision: CommandRule['decision']) => [
  ...rules.commands.filter((rule) => rule.pattern !== pattern),
  { pattern, decision },
]

/** Althar's own patterns, where a repository's docs say nothing and the person set none. */
const OWN = { branch: 'althar/{key}-{slug}', title: '{title}' } as const

/** What each repository's docs say of a kind of name, as the naming rows list them. */
const namingOf = (rules: ProjectRulesView, kind: 'branch' | 'title') =>
  rules.conventions.map((repository) => ({ id: repository.repository, name: repository.repository, found: repository[kind] }))

/** The agents with more than one account, as the accounts row lists them. */
export const agentAccountsOf = (agents: ReadonlyArray<AgentStatus>) =>
  agents
    .filter((agent) => agent.accounts.length > 1)
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      accounts: agent.accounts.map((account) => ({ id: account.id, label: account.name })),
    }))

export function RulesView({ model, onBack }: { model: RulesModel; onBack: () => void }) {
  const { rules } = model
  return (
    <div className={s.window}>
      <main className={s.scroll}>
        <div className={s.back}>
          <BackCrumb to={model.project ?? text.back} onBack={onBack} />
        </div>
        {model.error !== null && (
          <p className={s.error} role="alert">
            {model.error}
          </p>
        )}
        {rules === null ? (
          <PartPending label={pendingText.page} />
        ) : (
          <ProjectRules
            project={model.project ?? ''}
            permissionOptions={[PermissionPolicy.Rules, PermissionPolicy.Ask, PermissionPolicy.AllowAll]}
            permissions={toPolicy[rules.permissions]}
            onPermissionsChange={(policy) => model.change({ permissions: fromPolicy(policy) })}
            always={itemsOf(rules.commands, 'ask')}
            alwaysOn={[
              ...rules.alwaysAsk,
              ...rules.commands.filter((rule) => rule.decision === 'ask').map((rule) => commandId(rule.pattern)),
            ]}
            onAlwaysOnChange={(ids) => {
              const { kinds, commands } = listChange(rules, 'ask', ids)
              model.change({ alwaysAsk: kinds, commands })
            }}
            onAddRule={(pattern) => model.change({ commands: withCommand(rules, pattern, 'ask') })}
            never={itemsOf(rules.commands, 'never')}
            neverOn={[...rules.never, ...rules.commands.filter((rule) => rule.decision === 'never').map((rule) => commandId(rule.pattern))]}
            onNeverOnChange={(ids) => {
              const { kinds, commands } = listChange(rules, 'never', ids)
              model.change({ never: kinds, commands })
            }}
            onAddNever={(pattern) => model.change({ commands: withCommand(rules, pattern, 'never') })}
            end={rules.end === null ? TaskEnd.DraftPr : toEnd[rules.end]}
            onEndChange={(end) => model.change({ end })}
            branches={{
              value: rules.branchPattern,
              onChange: (pattern) => model.setPattern('branch', pattern),
              error: model.patternErrors.branch,
              exampleOf: (pattern) => fillPattern(pattern, text.example),
              fallback: OWN.branch,
              repositories: namingOf(rules, 'branch'),
            }}
            titles={{
              value: rules.titlePattern,
              onChange: (pattern) => model.setPattern('title', pattern),
              error: model.patternErrors.title,
              exampleOf: (pattern) => fillPattern(pattern, text.example),
              fallback: OWN.title,
              repositories: namingOf(rules, 'title'),
            }}
            templates={rules.conventions.map((repository) => ({
              id: repository.repository,
              name: repository.repository,
              path: repository.template,
            }))}
            limitOptions={[LimitPolicy.Move, LimitPolicy.Wait]}
            limits={rules.usageLimit === 'wait' ? LimitPolicy.Wait : LimitPolicy.Move}
            onLimitsChange={(limit) => model.change({ usageLimit: limit === LimitPolicy.Wait ? 'wait' : 'move' })}
            agentAccounts={agentAccountsOf(model.agents)}
            rotate={rules.rotateAccounts}
            onRotateChange={(rotateAccounts) => model.change({ rotateAccounts })}
            allowed={rules.onlyAccounts ?? {}}
            onAllowedChange={(agentId, ids) => {
              const every = model.agents.find((agent) => agent.id === agentId)?.accounts.length ?? 0
              const { [agentId]: _, ...others } = rules.onlyAccounts ?? {}
              const only = ids.length === every ? others : { ...others, [agentId]: ids }
              model.change({ onlyAccounts: Object.keys(only).length === 0 ? null : only })
            }}
            text={text.screen}
            className={s.rules}
          />
        )}
      </main>
    </div>
  )
}
