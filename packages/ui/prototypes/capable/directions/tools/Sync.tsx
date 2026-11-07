// Scrappy, surface 3: one switch that keeps the same MCP servers in each of the person's agents' own settings (Claude Code, Codex, OpenCode), for when they use them on their own. What it writes, to which file, and what it leaves alone: in a dialog before it starts (A), or on its card all along (B). A week on, it has copied a server added since, kept out one the person took out, and left alone a file it couldn't read.
import { type ReactElement, useState } from 'react'

import { Brand } from '../../../../src/foundations/brands/brands'
import { Icon } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { Button } from '../../../../src/primitives/Button/Button'
import { Dialog } from '../../../../src/primitives/Dialog/Dialog'
import { Tooltip } from '../../../../src/primitives/HoverCard/HoverCard'
import { LinkButton } from '../../../../src/primitives/LinkButton/LinkButton'
import { Menu, MenuCheckboxItem, MenuGroup, MenuItem, MenuSeparator } from '../../../../src/primitives/Menu/Menu'
import { Switch } from '../../../../src/primitives/Switch/Switch'
import { type Found, SERVERS } from './found'
import s from './sync.module.css'

export type AgentId = 'claude' | 'codex' | 'opencode'
export const AGENTS: ReadonlyArray<{ id: AgentId; name: string; brand: Brand; file: string }> = [
  { id: 'claude', name: 'Claude Code', brand: Brand.ClaudeCode, file: '~/.claude.json' },
  { id: 'codex', name: 'Codex', brand: Brand.Codex, file: '~/.codex/config.toml' },
  { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode, file: '~/.config/opencode/opencode.json' },
]
const agentOf = (id: AgentId) => AGENTS.find((one) => one.id === id)!

/** github runs two ways: Claude Code's with npx, Codex's in Docker. */
const WAYS = { npx: 'npx -y @github/github-mcp-server', docker: 'docker run -i ghcr.io/github/github-mcp-server' } as const
type Way = keyof typeof WAYS | 'apart'
/** Servers that sign in on their own, in each agent: a copy leaves a sign-in to do there. */
const SIGNS_IN = new Set(['linear', 'sentry', 'notion'])

/** A week on: a server the person added to Claude Code since, which sync copied to the others. */
const NOTION: Found = {
  id: 'notion',
  name: 'notion',
  sources: ['claude'],
  runs: 'https://mcp.notion.com/mcp',
  roles: ['lead', 'coordinator'],
}

export type Here = 'in' | 'added' | 'missing' | 'out' | 'signIn' | 'differs' | 'project'

const key = (found: Found, agent: AgentId) => `${found.id}:${agent}`

/** What sync has done and been told, as the page changed it; a week on, as it stands after one. */
export const useSync = ({ week, confirm }: { week: boolean; confirm: boolean }) => {
  const [on, setOn] = useState(week)
  /** What the person keeps out of an agent: taken back, left out of the plan, or taken out of the agent by hand. */
  const [out, setOut] = useState<ReadonlyArray<string>>(week ? ['context7:claude'] : [])
  const [way, setWay] = useState<Way | null>(week ? 'npx' : null)
  const [signedIn, setSignedIn] = useState<ReadonlyArray<string>>(
    week ? ['linear:codex', 'linear:opencode', 'sentry:codex', 'notion:codex'] : [],
  )
  /** A: the dialog open, to turn it on or off; B: turning off, asked on the card. */
  const [asking, setAsking] = useState<'on' | 'off' | null>(null)
  /** A week on, OpenCode's file has a mistake in it, so nothing was written there since. */
  const [broken, setBroken] = useState(week)
  /** Turned off with "Leave them in": what it added stays in each agent, as the person's own now. */
  const [stayed, setStayed] = useState<ReadonlyArray<string>>([])
  const servers = week ? [...SERVERS, NOTION] : SERVERS

  /** It would go to this agent, or went: not set up there, not kept out, and not github until it runs one way. */
  const planned = (found: Found, agent: AgentId) =>
    found.sources[0] !== 'project' &&
    !found.sources.includes(agent) &&
    !out.includes(key(found, agent)) &&
    (found.id !== 'github' || way === 'npx' || way === 'docker') &&
    !(broken && agent === 'opencode' && found.id === 'notion')
  const here = (found: Found, agent: AgentId): Here => {
    if (found.sources[0] === 'project') return agent === 'claude' ? 'in' : 'project'
    if (found.id === 'github' && agent !== 'opencode' && way === null) return 'differs'
    if (found.sources.includes(agent) || stayed.includes(key(found, agent))) return 'in'
    if (out.includes(key(found, agent))) return 'out'
    if (!on || !planned(found, agent)) return 'missing'
    return SIGNS_IN.has(found.id) && !signedIn.includes(key(found, agent)) ? 'signIn' : 'added'
  }
  const adds = (agent: AgentId, all = false) =>
    servers.filter((found) => (all ? found.sources[0] !== 'project' && !found.sources.includes(agent) : planned(found, agent)))
  const keepOut = (found: Found, agent: AgentId) => setOut((now) => [...new Set([...now, key(found, agent)])])
  const putBack = (found: Found, agent: AgentId) => setOut((now) => now.filter((one) => one !== key(found, agent)))
  const total = AGENTS.reduce((sum, agent) => sum + adds(agent.id).length, 0)
  const turn = (next: boolean) => {
    if (confirm || !next) setAsking(next ? 'on' : 'off')
    else setOn(true)
  }
  return {
    on,
    servers,
    week,
    way,
    broken,
    asking,
    total,
    here,
    planned,
    adds,
    keepOut,
    putBack,
    turn,
    pick: setWay,
    fix: () => setBroken(false),
    signIn: (found: Found, agent: AgentId) => setSignedIn((now) => [...now, key(found, agent)]),
    cancel: () => setAsking(null),
    start: () => {
      setOn(true)
      setAsking(null)
    },
    /** Off: what it added stays in the agents, or is taken back out of each. */
    stop: (takeBack: boolean) => {
      if (!takeBack)
        setStayed(servers.flatMap((found) => AGENTS.filter((agent) => planned(found, agent.id)).map((agent) => key(found, agent.id))))
      setOn(false)
      setAsking(null)
    },
  }
}
export type Sync = ReturnType<typeof useSync>

export const syncText = {
  keep: 'Keep your agents’ servers the same',
  what: 'Althar writes each server into Claude Code’s, Codex’s and OpenCode’s own settings, so each has them when you use it on its own.',
  later: 'A server you add to one later goes to the others. Each agent picks up a change when it next starts.',
  leaves: 'It leaves alone',
  leave: [
    'A server already in an agent, set up as you set it, on or off.',
    'One you take out of an agent: it stays out there.',
    'Sign-ins and tokens. Each agent signs in on its own; a token is copied as the name of its variable, never its value.',
  ],
  copy: 'It keeps a copy of each file before changing it, and turning it off can take back what it added.',
  willAdd: 'Adds',
  added: 'Added',
  nothing: 'Nothing to add',
  settle: 'To settle',
  recent: 'Since',
  project: 'In althar’s .mcp.json, which only Claude Code reads',
  turnOn: 'Turn on',
  offTitle: 'Stop keeping them the same?',
  offWhat: (n: number) => `It added ${n} servers to your agents’ settings. They can stay, or come out of each.`,
  keepThem: 'Leave them in',
  takeBack: 'Take them out',
}

/** github, set up two ways: one to run everywhere, which changes the other agent's, or github left out of syncing. */
function WayMenu({ sync, trigger }: { sync: Sync; trigger: ReactElement }) {
  return (
    <Menu label="How github runs" width={360} align="end" trigger={trigger}>
      <MenuGroup label="Run it everywhere as">
        <MenuItem
          lead={<BrandMark brand={Brand.ClaudeCode} size={12} />}
          description={<code className={s.way}>{WAYS.npx}</code>}
          onSelect={() => sync.pick('npx')}
        >
          Claude Code’s, which changes Codex’s
        </MenuItem>
        <MenuItem
          lead={<BrandMark brand={Brand.Codex} size={12} />}
          description={<code className={s.way}>{WAYS.docker}</code>}
          onSelect={() => sync.pick('docker')}
        >
          Codex’s, which changes Claude Code’s
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuItem onSelect={() => sync.pick('apart')}>Leave github out of syncing</MenuItem>
    </Menu>
  )
}

/** One agent's file, and the servers sync adds to it or added: each one a chip that leaves it out, or takes it back out. */
function FileRow({ sync, agent, done }: { sync: Sync; agent: (typeof AGENTS)[number]; done: boolean }) {
  const all = sync.adds(agent.id, true).filter((found) => !(found.id === 'github' && (sync.way === null || sync.way === 'apart')))
  const left = all.filter((found) => sync.here(found, agent.id) === 'out')
  const going = all.filter((found) => !left.includes(found) && (done ? sync.here(found, agent.id) !== 'missing' : true))
  return (
    <li className={s.file}>
      <span className={s.fileWho}>
        <BrandMark brand={agent.brand} size={13} />
        <span className={s.fileName}>{agent.name}</span>
        <code className={s.filePath} title={agent.file}>
          {agent.file}
        </code>
      </span>
      <span className={s.chips}>
        {going.length === 0 && left.length === 0 && <span className={s.nothing}>{syncText.nothing}</span>}
        {going.map((found) => (
          <Tooltip key={found.id} label={done ? `Take ${found.name} out of ${agent.name}` : `Leave ${found.name} out of ${agent.name}`}>
            <button type="button" className={s.chip} onClick={() => sync.keepOut(found, agent.id)}>
              {found.name}
              <Icon name="close" size={10} />
            </button>
          </Tooltip>
        ))}
        {left.map((found) => (
          <Tooltip key={found.id} label={`Put ${found.name} back in ${agent.name}`}>
            <button type="button" className={s.chip} data-out="" onClick={() => sync.putBack(found, agent.id)}>
              {found.name}
              <Icon name="plus" size={10} />
            </button>
          </Tooltip>
        ))}
      </span>
    </li>
  )
}

function Files({ sync, done }: { sync: Sync; done: boolean }) {
  return (
    <div className={s.files}>
      <span className={s.label}>{done ? syncText.added : syncText.willAdd}</span>
      <ul className={s.fileList}>
        {AGENTS.map((agent) => (
          <FileRow key={agent.id} sync={sync} agent={agent} done={done} />
        ))}
      </ul>
      {!done && sync.way === null && (
        <span className={s.waits}>
          <BrandMark brand={Brand.GitHub} size={13} />
          <span className={s.settleWhat}>
            <strong>github</strong> runs with npx in Claude Code and in Docker in Codex, so it isn’t copied until you pick one.
          </span>
          <WayMenu
            sync={sync}
            trigger={
              <Button size="small" variant="quiet" trailingIcon="chevronD">
                Pick one
              </Button>
            }
          />
        </span>
      )}
    </div>
  )
}

/** What a person needs to know before it writes to their files: what it leaves alone, and that it can be taken back. */
function Leaves() {
  return (
    <div className={s.leaves}>
      <span className={s.label}>{syncText.leaves}</span>
      <ul className={s.leaveList}>
        {syncText.leave.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className={s.copy}>{syncText.copy}</p>
    </div>
  )
}

/** What it can't do alone, problems first: a file it can't read, github's two ways, then each sign-in. */
function Settle({ sync }: { sync: Sync }) {
  const signIns = sync.servers
    .map((found) => ({ found, agents: AGENTS.filter((agent) => sync.here(found, agent.id) === 'signIn') }))
    .filter((one) => one.agents.length > 0)
  const rows = [
    sync.broken && (
      <span key="broken" className={s.settleRow} data-tone="bad">
        <BrandMark brand={Brand.OpenCode} size={13} />
        <span className={s.settleWhat}>OpenCode’s settings have a mistake on line 14, so nothing has been written there since 4 Nov.</span>
        <Button size="small" variant="quiet" onClick={sync.fix}>
          Open the file
        </Button>
      </span>
    ),
    sync.way === null && (
      <span key="github" className={s.settleRow}>
        <BrandMark brand={Brand.GitHub} size={13} />
        <span className={s.settleWhat}>
          <strong>github</strong> runs with npx in Claude Code and in Docker in Codex, so it isn’t copied until you pick one.
        </span>
        <WayMenu
          sync={sync}
          trigger={
            <Button size="small" variant="quiet" trailingIcon="chevronD">
              Pick one
            </Button>
          }
        />
      </span>
    ),
    ...signIns.map(({ found, agents }) => (
      <span key={found.id} className={s.settleRow}>
        <Icon name="plug" size={13} />
        <span className={s.settleWhat}>
          <strong>{found.name}</strong> signs in on its own in each agent.
        </span>
        {agents.map((agent) => (
          <Button key={agent.id} size="small" variant="quiet" onClick={() => sync.signIn(found, agent.id)}>
            {`Sign in to ${agent.name}`}
          </Button>
        ))}
      </span>
    )),
  ].filter(Boolean)
  if (rows.length === 0) return null
  return (
    <div className={s.settle}>
      <span className={s.label}>{syncText.settle}</span>
      {rows}
    </div>
  )
}

/** A week on: what it did since it was turned on, and a decision of the person's it kept. */
function Since({ sync }: { sync: Sync }) {
  const notion = sync.servers.find((one) => one.id === 'notion')
  const context7 = SERVERS.find((one) => one.id === 'context7')!
  if (!sync.week || notion === undefined) return null
  const copied = (['codex', 'opencode'] as const).filter(
    (agent) => sync.here(notion, agent) !== 'missing' && sync.here(notion, agent) !== 'out',
  )
  const kept = sync.here(context7, 'claude') === 'out'
  return (
    <div className={s.since}>
      <span className={s.label}>{syncText.recent}</span>
      <span className={s.sinceRow}>
        <BrandMark brand={Brand.ClaudeCode} size={13} />
        <span className={s.settleWhat}>
          You added <strong>notion</strong> to Claude Code.{' '}
          {copied.length > 0 ? `Copied to ${copied.map((one) => agentOf(one).name).join(' and ')}.` : 'Not copied.'}
          {sync.broken && ' Not to OpenCode yet.'}
        </span>
        <span className={s.when}>3 min ago</span>
        {copied.length > 0 && (
          <LinkButton className={s.undo} onClick={() => copied.forEach((agent) => sync.keepOut(notion, agent))}>
            Undo
          </LinkButton>
        )}
      </span>
      <span className={s.sinceRow}>
        <BrandMark brand={Brand.ClaudeCode} size={13} />
        <span className={s.settleWhat}>
          {kept ? (
            <>
              You took <strong>context7</strong> out of Claude Code. It stays out there.
            </>
          ) : (
            <>
              <strong>context7</strong> is back in Claude Code.
            </>
          )}
        </span>
        <span className={s.when}>2 Nov</span>
        <LinkButton className={s.undo} onClick={() => (kept ? sync.putBack(context7, 'claude') : sync.keepOut(context7, 'claude'))}>
          {kept ? 'Put it back' : 'Undo'}
        </LinkButton>
      </span>
    </div>
  )
}

/** The card over the table: the switch, and what it writes, in a dialog before it starts (A, chosen 7 Nov). */
export function KeepSame({ sync }: { sync: Sync }) {
  return (
    <div className={s.keep}>
      <div className={s.keepRow}>
        <span className={s.keepText}>
          <span className={s.keepTitle}>{syncText.keep}</span>
          <span className={s.keepNote}>{sync.on ? syncText.later : syncText.what}</span>
        </span>
        <Switch checked={sync.on} label={syncText.keep} onChange={sync.turn} />
      </div>
      {sync.on && (
        <>
          <Settle sync={sync} />
          <Since sync={sync} />
          <Files sync={sync} done />
        </>
      )}
      {sync.asking === 'on' && (
        <Dialog
          title={syncText.keep}
          description={`${syncText.what} ${syncText.later}`}
          width={600}
          onClose={sync.cancel}
          actions={
            <>
              <Button variant="quiet" onClick={sync.cancel}>
                Cancel
              </Button>
              <Button variant="signal" onClick={sync.start}>
                {syncText.turnOn}
              </Button>
            </>
          }
        >
          <div className={s.dialogBody}>
            <Files sync={sync} done={false} />
            <Leaves />
          </div>
        </Dialog>
      )}
      {sync.asking === 'off' && (
        <Dialog
          title={syncText.offTitle}
          description={syncText.offWhat(sync.total)}
          onClose={sync.cancel}
          actions={
            <>
              <Button variant="quiet" onClick={sync.cancel}>
                Cancel
              </Button>
              <Button variant="quiet" onClick={() => sync.stop(true)}>
                {syncText.takeBack}
              </Button>
              <Button onClick={() => sync.stop(false)}>{syncText.keepThem}</Button>
            </>
          }
        />
      )}
    </div>
  )
}

/** Each agent's mark beside a server's name: solid where it is, faint where it isn't; they open a menu that keeps it out of an agent, or puts it back. */
export function AgentMarks({ found, sync }: { found: Found; sync: Sync }) {
  const marks = AGENTS.map((agent) => {
    const here = sync.here(found, agent.id)
    const said =
      here === 'in'
        ? `In ${agent.name}`
        : here === 'added'
          ? `In ${agent.name}, copied by Althar`
          : here === 'missing'
            ? `Not in ${agent.name}`
            : here === 'out'
              ? `Kept out of ${agent.name}`
              : here === 'signIn'
                ? `In ${agent.name}, to sign in`
                : here === 'differs'
                  ? `In ${agent.name}, run another way`
                  : syncText.project
    return { agent, here, said }
  })
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
  if (found.sources[0] === 'project') return faces
  return (
    <Menu
      label={`${found.name} in your agents`}
      width={260}
      trigger={
        <button type="button" className={s.marksButton} aria-label={`${found.name} in your agents`}>
          {faces}
        </button>
      }
    >
      <MenuGroup label={`${found.name} in your agents`}>
        {marks.map(({ agent, here }) => (
          <MenuCheckboxItem
            key={agent.id}
            keepOpen
            checked={
              here === 'in' || here === 'added' || here === 'signIn' || here === 'differs' || (!sync.on && sync.planned(found, agent.id))
            }
            disabled={here === 'in' || here === 'differs' || (found.id === 'github' && here !== 'added' && here !== 'out')}
            {...(here === 'in'
              ? { description: 'Set up there by you' }
              : here === 'differs'
                ? { description: 'Set up there another way' }
                : found.id === 'github' && here !== 'added' && here !== 'out'
                  ? { description: 'Once you pick how github runs' }
                  : {})}
            onCheckedChange={(next) => (next ? sync.putBack(found, agent.id) : sync.keepOut(found, agent.id))}
          >
            {agent.name}
          </MenuCheckboxItem>
        ))}
      </MenuGroup>
    </Menu>
  )
}
