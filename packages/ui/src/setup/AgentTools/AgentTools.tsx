import { Checkbox } from 'radix-ui'
import { useState } from 'react'

import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { Button } from '../../primitives/Button/Button'
import box from '../../primitives/CheckList/CheckList.module.css'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Menu, MenuCheckboxItem, MenuGroup, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { Switch } from '../../primitives/Switch/Switch'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './AgentTools.module.css'

/*
 * The person's own MCP servers and skills, in Settings (ADR-097): a table,
 * a row each and a column for each role that gets it, for every project or
 * one; each agent's mark beside a name, solid where it has it; and over the
 * table, the switch that keeps their agents the same. A server's switch
 * says, before it starts, what it writes into each agent's file and what it
 * leaves alone (a dialog: it writes into files that are the person's);
 * once on, what's To settle, what it did Since, and what it Added to each
 * file, a chip per server that takes it back out. Skills' switch only adds
 * links, so it says so on its card and starts at once.
 */

export type ToolAgent = 'claude' | 'codex' | 'opencode'
export type ToolRoleId = 'lead' | 'reviewer' | 'coordinator'
export type ToolHereKind = 'in' | 'added' | 'missing' | 'out' | 'differs' | 'cant'

export interface ToolRowModel {
  name: string
  /** What a server runs or calls; what a skill is for. */
  about: string
  brand?: Brand | undefined
  /** Where it was found: the agent, or the repository, by the file it was read from. */
  sources: ReadonlyArray<{ from: ToolAgent | 'repository' | 'plugin' | 'althar'; where: string }>
  roles: ReadonlyArray<ToolRoleId>
  here: Readonly<Record<ToolAgent, ToolHereKind>>
}

export type ToolSettleModel =
  | { kind: 'unreadable'; agent: ToolAgent; file: string; problem: string }
  | { kind: 'differs'; name: string; ways: ReadonlyArray<{ agent: ToolAgent; runs: string }> }
  | { kind: 'cant'; name: string; agent: ToolAgent; why: 'sse' | 'secret' | 'headers' | 'reference' }
  | { kind: 'signIn'; name: string; agents: ReadonlyArray<ToolAgent> }

export interface ToolSyncModel {
  on: boolean
  settle: ReadonlyArray<ToolSettleModel>
  since: ReadonlyArray<{
    id: string
    at: string
    name: string
    kind: 'copied' | 'tookOut'
    from: ToolAgent
    to: ReadonlyArray<ToolAgent>
    undone: boolean
  }>
  targets: ReadonlyArray<{ agent: ToolAgent; where: string; adds: ReadonlyArray<string>; out: ReadonlyArray<string> }>
  errors: ReadonlyArray<string>
}

export interface AgentToolsProps {
  kind: 'server' | 'skill'
  rows: ReadonlyArray<ToolRowModel>
  sync: ToolSyncModel
  /** The projects the roles can be set for, beside every project; the one shown (null for every project). */
  scope?: { projects: ReadonlyArray<{ id: string; name: string }>; value: string | null; onChange: (projectId: string | null) => void }
  /** Whether roles can be set here: servers' are given each session by role, skills' are each agent's own. */
  roleTicks?: boolean
  onRoles?: (name: string, roles: ReadonlyArray<ToolRoleId>) => void
  onSync: (on: boolean, takeBack: boolean) => void
  onKeep: (agent: ToolAgent, name: string, out: boolean) => void
  onPick: (name: string, way: ToolAgent | 'apart') => void
  onUndo?: (id: string) => void
  onSignIn?: (agent: ToolAgent, name: string) => void
  /** When a line under Since happened, as the page says it. */
  when?: (at: string) => string
  className?: string
}

export const AGENTS: ReadonlyArray<{ id: ToolAgent; name: string; brand: Brand }> = [
  { id: 'claude', name: 'Claude Code', brand: Brand.ClaudeCode },
  { id: 'codex', name: 'Codex', brand: Brand.Codex },
  { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode },
]
const agentOf = (id: ToolAgent) => AGENTS.find((one) => one.id === id)!
const ROLES: ReadonlyArray<{ id: ToolRoleId; plural: string }> = [
  { id: 'lead', plural: 'Leads' },
  { id: 'reviewer', plural: 'Reviewers' },
  { id: 'coordinator', plural: 'Coordinator' },
]

export const agentToolsText = {
  name: { server: 'Server', skill: 'Skill' },
  every: 'Every project',
  scope: 'For',
  none: { server: 'None of your agents has an MCP server set up.', skill: 'None of your agents has a skill of yours.' },
  server: {
    keep: 'Keep your agents’ servers the same',
    what: 'Althar writes each server into Claude Code’s, Codex’s and OpenCode’s own settings, so each has them when you use it on its own.',
    later: 'A server you add to one later goes to the others. Each agent picks up a change when it next starts.',
    leave: [
      'A server already in an agent, set up as you set it, on or off.',
      'One you take out of an agent: it stays out there.',
      'Sign-ins and tokens. Each agent signs in on its own; a token is copied as the name of its variable, never its value.',
    ],
    copy: 'It keeps a copy of each file before changing it, and turning it off can take back what it added.',
    offTitle: 'Stop keeping them the same?',
    offWhat: (n: number) =>
      n === 0
        ? 'It added nothing to your agents’ settings.'
        : `It added ${n} ${n === 1 ? 'server' : 'servers'} to your agents’ settings. They can stay, or come out of each.`,
    keepThem: 'Leave them in',
  },
  skill: {
    keep: 'Keep your agents’ skills the same',
    what: 'Althar links each of your skills into Claude Code’s and Codex’s skill folders; OpenCode reads both. The skill stays where it is, so a change to it reaches every agent.',
    later: 'A skill you add to one later is linked into the others.',
    leave: [
      'Each skill’s own folder: nothing is moved or copied.',
      'Skills from a plugin. They update with it, so they stay in Claude Code.',
      'The repository’s .claude/skills, which is the project’s to change.',
      'Althar’s own skills. Every role gets them in Althar already.',
    ],
    copy: 'What a skill says only Claude Code understands, such as which tools it may use, the others ignore.',
    offTitle: 'Stop keeping them the same?',
    offWhat: (n: number) =>
      n === 0
        ? 'It linked nothing.'
        : `It linked ${n} ${n === 1 ? 'skill' : 'skills'} into your agents’ folders. The links can stay, or come out.`,
    keepThem: 'Leave them',
  },
  leaves: 'It leaves alone',
  willAdd: { server: 'Adds', skill: 'Links' },
  added: { server: 'Added', skill: 'Linked' },
  nothing: 'Nothing to add',
  settle: 'To settle',
  since: 'Since',
  turnOn: 'Turn on',
  cancel: 'Cancel',
  takeBack: 'Take them out',
  pick: 'Pick one',
  runEverywhere: 'Run it everywhere as',
  useEverywhere: 'Use everywhere',
  theirs: (agent: string) => `${agent}’s`,
  apart: { server: (name: string) => `Leave ${name} out of syncing`, skill: () => 'Keep both, as they are' },
  differs: {
    server: (name: string, ways: string) => `${name} runs ${ways}, so it isn’t copied until you pick one.`,
    skill: (name: string, agents: string) => `${name} is in ${agents}, but they differ.`,
  },
  unreadable: (agent: string, problem: string) => `${agent}’s settings can’t be read: ${problem} Nothing is written there until they can.`,
  cant: {
    sse: (name: string, agent: string) => `${name} runs over SSE, which ${agent} doesn’t take.`,
    secret: (name: string, agent: string) =>
      `${name} has a token written out in its settings, so it isn’t copied to ${agent}. Give it as a variable to copy it.`,
    headers: (name: string, agent: string) => `${name} sends headers ${agent} can’t be given, so it isn’t copied there.`,
    reference: (name: string, agent: string) => `${name} reads a variable ${agent} takes only as a value, so it isn’t copied there.`,
  },
  signsIn: (name: string) => `${name} signs in on its own in each agent.`,
  signInTo: (agent: string) => `Sign in to ${agent}`,
  copied: (name: string, from: string, to: string) => `You added ${name} to ${from}. Copied to ${to}.`,
  tookOut: (name: string, from: string) => `You took ${name} out of ${from}. It stays out there.`,
  undo: 'Undo',
  putBack: 'Put it back',
  leaveOut: (name: string, agent: string) => `Leave ${name} out of ${agent}`,
  takeOut: (name: string, agent: string) => `Take ${name} out of ${agent}`,
  putIn: (name: string, agent: string) => `Put ${name} back in ${agent}`,
  inAgents: (name: string) => `${name} in your agents`,
  here: {
    in: (agent: string) => `In ${agent}`,
    added: (agent: string) => `In ${agent}, copied by Althar`,
    missing: (agent: string) => `Not in ${agent}`,
    out: (agent: string) => `Kept out of ${agent}`,
    differs: (agent: string) => `In ${agent}, set up another way`,
    cant: (agent: string) => `Not in ${agent}: it can’t be copied there`,
  },
  setByYou: 'Set up there by you',
  roleGets: (role: string, name: string) => `${role} get ${name}`,
}

const and = (items: ReadonlyArray<string>) =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/** One agent's file, and what sync adds there or added: each a chip that leaves it out, or takes it back out. */
function Target({
  kind,
  target,
  done,
  onKeep,
}: {
  kind: 'server' | 'skill'
  target: ToolSyncModel['targets'][number]
  done: boolean
  onKeep: AgentToolsProps['onKeep']
}) {
  const t = agentToolsText
  const agent = agentOf(target.agent)
  return (
    <li className={s.file}>
      <span className={s.fileWho}>
        <BrandMark brand={agent.brand} size={13} />
        <span className={s.fileName}>{agent.name}</span>
        <code className={s.filePath} title={target.where}>
          {target.where}
        </code>
      </span>
      <span className={s.chips}>
        {target.adds.length === 0 && target.out.length === 0 && <span className={s.nothing}>{t.nothing}</span>}
        {target.adds.map((name) => (
          <Tooltip key={name} label={done ? t.takeOut(name, agent.name) : t.leaveOut(name, agent.name)}>
            <button type="button" className={s.chip} onClick={() => onKeep(target.agent, name, true)}>
              {name}
              <Icon name="close" size={10} />
            </button>
          </Tooltip>
        ))}
        {target.out.map((name) => (
          <Tooltip key={name} label={t.putIn(name, agent.name)}>
            <button type="button" className={s.chip} data-out="" onClick={() => onKeep(target.agent, name, false)}>
              {name}
              <Icon name="plus" size={10} />
            </button>
          </Tooltip>
        ))}
      </span>
    </li>
  )
}

function Targets({
  kind,
  sync,
  done,
  onKeep,
}: {
  kind: 'server' | 'skill'
  sync: ToolSyncModel
  done: boolean
  onKeep: AgentToolsProps['onKeep']
}) {
  return (
    <div className={s.files}>
      <span className={s.label}>{done ? agentToolsText.added[kind] : agentToolsText.willAdd[kind]}</span>
      <ul className={s.fileList}>
        {sync.targets.map((target) => (
          <Target key={target.agent} kind={kind} target={target} done={done} onKeep={onKeep} />
        ))}
      </ul>
    </div>
  )
}

/** For one set up two ways: whose runs everywhere, or left out. */
function WayMenu({
  kind,
  item,
  onPick,
}: {
  kind: 'server' | 'skill'
  item: Extract<ToolSettleModel, { kind: 'differs' }>
  onPick: AgentToolsProps['onPick']
}) {
  const t = agentToolsText
  return (
    <Menu
      label={item.name}
      width={360}
      align="end"
      trigger={
        <Button size="small" variant="quiet" trailingIcon="chevronD">
          {t.pick}
        </Button>
      }
    >
      <MenuGroup label={kind === 'server' ? t.runEverywhere : t.useEverywhere}>
        {item.ways.map((way) => (
          <MenuItem
            key={way.agent}
            lead={<BrandMark brand={agentOf(way.agent).brand} size={12} />}
            description={<code className={s.way}>{way.runs}</code>}
            onSelect={() => onPick(item.name, way.agent)}
          >
            {t.theirs(agentOf(way.agent).name)}
          </MenuItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem onSelect={() => onPick(item.name, 'apart')}>{t.apart[kind](item.name)}</MenuItem>
    </Menu>
  )
}

/** What it can't do alone, problems first: a file it can't read, one set up two ways, what it can't carry, then each sign-in. */
function Settle({
  kind,
  sync,
  onPick,
  onSignIn,
}: {
  kind: 'server' | 'skill'
  sync: ToolSyncModel
  onPick: AgentToolsProps['onPick']
  onSignIn: AgentToolsProps['onSignIn']
}) {
  const t = agentToolsText
  const order = { unreadable: 0, differs: 1, cant: 2, signIn: 3 } as const
  const items = [...sync.settle].sort((one, other) => order[one.kind] - order[other.kind])
  if (items.length === 0) return null
  return (
    <div className={s.settle}>
      <span className={s.label}>{t.settle}</span>
      {items.map((item) => {
        switch (item.kind) {
          case 'unreadable':
            return (
              <span key={`u:${item.agent}`} className={s.settleRow} data-tone="bad">
                <BrandMark brand={agentOf(item.agent).brand} size={13} />
                <span className={s.settleWhat}>{t.unreadable(agentOf(item.agent).name, item.problem)}</span>
              </span>
            )
          case 'differs':
            return (
              <span key={`d:${item.name}`} className={s.settleRow}>
                <Icon name={kind === 'server' ? 'plug' : 'knowledge'} size={13} />
                <span className={s.settleWhat}>
                  {kind === 'server'
                    ? t.differs.server(item.name, and(item.ways.map((way) => `as ${way.runs.split(' ')[0]} in ${agentOf(way.agent).name}`)))
                    : t.differs.skill(item.name, and(item.ways.map((way) => agentOf(way.agent).name)))}
                </span>
                <WayMenu kind={kind} item={item} onPick={onPick} />
              </span>
            )
          case 'cant':
            return (
              <span key={`c:${item.name}:${item.agent}`} className={s.settleRow}>
                <BrandMark brand={agentOf(item.agent).brand} size={13} />
                <span className={s.settleWhat}>{t.cant[item.why](item.name, agentOf(item.agent).name)}</span>
              </span>
            )
          case 'signIn':
            return (
              <span key={`s:${item.name}`} className={s.settleRow}>
                <Icon name="plug" size={13} />
                <span className={s.settleWhat}>{t.signsIn(item.name)}</span>
                {item.agents
                  .filter((agent) => agent !== 'opencode')
                  .map((agent) => (
                    <Button key={agent} size="small" variant="quiet" onClick={() => onSignIn?.(agent, item.name)}>
                      {t.signInTo(agentOf(agent).name)}
                    </Button>
                  ))}
              </span>
            )
        }
      })}
    </div>
  )
}

function Since({ sync, onUndo, when }: { sync: ToolSyncModel; onUndo: AgentToolsProps['onUndo']; when: (at: string) => string }) {
  const t = agentToolsText
  const shown = sync.since.filter((each) => !each.undone).slice(0, 5)
  if (shown.length === 0 || onUndo === undefined) return null
  return (
    <div className={s.since}>
      <span className={s.label}>{t.since}</span>
      {shown.map((each) => (
        <span key={each.id} className={s.sinceRow}>
          <BrandMark brand={agentOf(each.from).brand} size={13} />
          <span className={s.settleWhat}>
            {each.kind === 'copied'
              ? t.copied(each.name, agentOf(each.from).name, and(each.to.map((agent) => agentOf(agent).name)))
              : t.tookOut(each.name, agentOf(each.from).name)}
          </span>
          <span className={s.when}>{when(each.at)}</span>
          <LinkButton className={s.undo} onClick={() => onUndo(each.id)}>
            {each.kind === 'copied' ? t.undo : t.putBack}
          </LinkButton>
        </span>
      ))}
    </div>
  )
}

function Leaves({ kind }: { kind: 'server' | 'skill' }) {
  return (
    <div className={s.leaves}>
      <span className={s.label}>{agentToolsText.leaves}</span>
      <ul className={s.leaveList}>
        {agentToolsText[kind].leave.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className={s.copy}>{agentToolsText[kind].copy}</p>
    </div>
  )
}

/** The card over the table: the switch, and what it does; for servers, said in a dialog before it starts. */
export function KeepSame({
  kind,
  sync,
  onSync,
  onKeep,
  onPick,
  onUndo,
  onSignIn,
  when = (at) => at.slice(0, 10),
}: Pick<AgentToolsProps, 'kind' | 'sync' | 'onSync' | 'onKeep' | 'onPick' | 'onUndo' | 'onSignIn' | 'when'>) {
  const t = agentToolsText
  const words = t[kind]
  const [asking, setAsking] = useState<'on' | 'off' | null>(null)
  const added = sync.targets.reduce((sum, target) => sum + target.adds.length, 0)
  const turn = (next: boolean) => {
    if (next && kind === 'skill') onSync(true, false)
    else setAsking(next ? 'on' : 'off')
  }
  return (
    <div className={s.keep}>
      <div className={s.keepRow}>
        <span className={s.keepText}>
          <span className={s.keepTitle}>{words.keep}</span>
          <span className={s.keepNote}>{sync.on ? words.later : words.what}</span>
        </span>
        <Switch checked={sync.on} label={words.keep} onChange={turn} />
      </div>
      {sync.errors.length > 0 && (
        <p className={s.errors} role="alert">
          {sync.errors.join(' ')}
        </p>
      )}
      {sync.on ? (
        <>
          <Settle kind={kind} sync={sync} onPick={onPick} onSignIn={onSignIn} />
          <Since sync={sync} onUndo={onUndo} when={when} />
          <Targets kind={kind} sync={sync} done onKeep={onKeep} />
        </>
      ) : (
        kind === 'skill' && (
          <div className={s.body}>
            <Targets kind={kind} sync={sync} done={false} onKeep={onKeep} />
            <Settle kind={kind} sync={sync} onPick={onPick} onSignIn={onSignIn} />
            <Leaves kind={kind} />
          </div>
        )
      )}
      {asking === 'on' && (
        <Dialog
          title={words.keep}
          description={`${words.what} ${words.later}`}
          width={600}
          onClose={() => setAsking(null)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setAsking(null)}>
                {t.cancel}
              </Button>
              <Button
                variant="signal"
                onClick={() => {
                  setAsking(null)
                  onSync(true, false)
                }}
              >
                {t.turnOn}
              </Button>
            </>
          }
        >
          <div className={s.dialogBody}>
            <Targets kind={kind} sync={sync} done={false} onKeep={onKeep} />
            {sync.settle.some((each) => each.kind === 'differs' || each.kind === 'unreadable') && (
              <Settle
                kind={kind}
                sync={{ ...sync, settle: sync.settle.filter((each) => each.kind !== 'signIn') }}
                onPick={onPick}
                onSignIn={onSignIn}
              />
            )}
            <Leaves kind={kind} />
          </div>
        </Dialog>
      )}
      {asking === 'off' && (
        <Dialog
          title={words.offTitle}
          description={words.offWhat(added)}
          onClose={() => setAsking(null)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setAsking(null)}>
                {t.cancel}
              </Button>
              <Button
                variant="quiet"
                onClick={() => {
                  setAsking(null)
                  onSync(false, true)
                }}
              >
                {t.takeBack}
              </Button>
              <Button
                onClick={() => {
                  setAsking(null)
                  onSync(false, false)
                }}
              >
                {words.keepThem}
              </Button>
            </>
          }
        />
      )}
    </div>
  )
}

/** Each agent's mark beside a name: solid where it is, faint where it isn't; for a server, a menu that keeps it out of one. */
function Marks({
  kind,
  row,
  sync,
  onKeep,
}: {
  kind: 'server' | 'skill'
  row: ToolRowModel
  sync: ToolSyncModel
  onKeep: AgentToolsProps['onKeep']
}) {
  const t = agentToolsText
  const marks = AGENTS.map((agent) => ({ agent, here: row.here[agent.id], said: t.here[row.here[agent.id]](agent.name) }))
  const faces = (
    <span className={s.marks}>
      {marks.map(({ agent, here, said }) => (
        <Tooltip key={agent.id} label={said}>
          <span className={s.mark} data-here={here} aria-label={said}>
            <BrandMark brand={agent.brand} size={12} />
          </span>
        </Tooltip>
      ))}
    </span>
  )
  if (kind === 'skill') return faces
  const planned = (agent: ToolAgent) => sync.targets.find((target) => target.agent === agent)?.adds.includes(row.name) === true
  return (
    <Menu
      label={t.inAgents(row.name)}
      width={260}
      trigger={
        <button type="button" className={s.marksButton} aria-label={t.inAgents(row.name)}>
          {faces}
        </button>
      }
    >
      <MenuGroup label={t.inAgents(row.name)}>
        {marks.map(({ agent, here }) => (
          <MenuCheckboxItem
            key={agent.id}
            keepOpen
            checked={here === 'in' || here === 'added' || here === 'differs' || planned(agent.id)}
            disabled={here === 'in' || here === 'differs' || here === 'cant'}
            {...(here === 'in' ? { description: t.setByYou } : here === 'differs' ? { description: t.here.differs(agent.name) } : {})}
            onCheckedChange={(next) => onKeep(agent.id, row.name, next !== true)}
          >
            {agent.name}
          </MenuCheckboxItem>
        ))}
      </MenuGroup>
    </Menu>
  )
}

/** One section's table and its switch: Settings › MCP servers, or Settings › Skills. */
export function AgentTools({
  kind,
  rows,
  sync,
  scope,
  roleTicks = kind === 'server',
  onRoles,
  onSync,
  onKeep,
  onPick,
  onUndo,
  onSignIn,
  when,
  className,
}: AgentToolsProps) {
  const t = agentToolsText
  const tick = (row: ToolRowModel, role: (typeof ROLES)[number]) => (
    <Checkbox.Root
      checked={row.roles.includes(role.id)}
      className={box.box}
      aria-label={t.roleGets(role.plural, row.name)}
      onCheckedChange={(next) =>
        onRoles?.(
          row.name,
          ROLES.map((each) => each.id).filter((id) => (id === role.id ? next === true : row.roles.includes(id))),
        )
      }
    >
      <Checkbox.Indicator className={box.tick}>
        <Icon name="check" size={10} />
      </Checkbox.Indicator>
    </Checkbox.Root>
  )
  return (
    <div className={[s.page, className].filter(Boolean).join(' ')}>
      {roleTicks && scope !== undefined && scope.projects.length > 0 && (
        <div className={s.scope}>
          <Segmented<string>
            label={t.scope}
            value={scope.value ?? ''}
            onChange={(value) => scope.onChange(value === '' ? null : value)}
            options={[{ value: '', label: t.every }, ...scope.projects.map((project) => ({ value: project.id, label: project.name }))]}
          />
        </div>
      )}
      <KeepSame
        kind={kind}
        sync={sync}
        onSync={onSync}
        onKeep={onKeep}
        onPick={onPick}
        {...(onUndo === undefined ? {} : { onUndo })}
        {...(onSignIn === undefined ? {} : { onSignIn })}
        {...(when === undefined ? {} : { when })}
      />
      {rows.length === 0 ? (
        <p className={s.none}>{t.none[kind]}</p>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col" className={s.corner}>
                <VisuallyHidden>{t.name[kind]}</VisuallyHidden>
              </th>
              {roleTicks &&
                ROLES.map((role) => (
                  <th key={role.id} scope="col" className={s.roleHead}>
                    {role.plural}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <th scope="row" className={s.nameCell}>
                  <div className={s.nameBox}>
                    <span className={s.nameLine}>
                      {row.brand !== undefined ? (
                        <BrandMark brand={row.brand} size={14} />
                      ) : (
                        <Icon name={kind === 'server' ? 'plug' : 'knowledge'} size={13} />
                      )}
                      <span className={s.name}>{row.name}</span>
                      <Marks kind={kind} row={row} sync={sync} onKeep={onKeep} />
                    </span>
                    {row.about !== '' && <span className={kind === 'server' ? s.runs : s.about}>{row.about}</span>}
                  </div>
                </th>
                {roleTicks &&
                  ROLES.map((role) => (
                    <td key={role.id} className={s.tick}>
                      {tick(row, role)}
                    </td>
                  ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
