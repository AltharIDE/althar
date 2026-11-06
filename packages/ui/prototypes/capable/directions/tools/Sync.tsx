// Scrappy, surface 3: the same MCP server in each of the person's agents' own settings (Claude Code, Codex, OpenCode), for when they use them outside Althar. Three ways on the role table: a column per agent (A), marks in the row (B), one switch (C).
import { Checkbox } from 'radix-ui'
import { useState } from 'react'

import { Brand } from '../../../../src/foundations/brands/brands'
import { Icon } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { Button } from '../../../../src/primitives/Button/Button'
import { Tooltip } from '../../../../src/primitives/HoverCard/HoverCard'
import { LinkButton } from '../../../../src/primitives/LinkButton/LinkButton'
import { Menu, MenuGroup, MenuItem, MenuSeparator } from '../../../../src/primitives/Menu/Menu'
import { Switch } from '../../../../src/primitives/Switch/Switch'
import box from '../../../../src/primitives/CheckList/CheckList.module.css'
import { type Found, SERVERS } from './found'
import s from './sync.module.css'

export type AgentId = 'claude' | 'codex' | 'opencode'
export const AGENTS: ReadonlyArray<{ id: AgentId; name: string; brand: Brand; file: string }> = [
  { id: 'claude', name: 'Claude Code', brand: Brand.ClaudeCode, file: '~/.claude.json' },
  { id: 'codex', name: 'Codex', brand: Brand.Codex, file: '~/.codex/config.toml' },
  { id: 'opencode', name: 'OpenCode', brand: Brand.OpenCode, file: '~/.config/opencode/opencode.json' },
]

/** How it runs in each agent where they differ: github, as Claude Code and Codex each have it. */
const DIFFERS: Readonly<Record<string, Partial<Record<AgentId, string>>>> = {
  github: { claude: 'npx -y @github/github-mcp-server', codex: 'docker run -i ghcr.io/github/github-mcp-server' },
}
/** Servers that sign in on their own, in each agent: copying one leaves a sign-in to do there. */
const SIGNS_IN = new Set(['linear', 'sentry'])

export type Here = 'in' | 'differs' | 'missing' | 'signIn' | 'project'

/** Where each server is now, as the page changed it. */
export const useSync = () => {
  const [added, setAdded] = useState<Record<string, ReadonlyArray<AgentId>>>({})
  const [settled, setSettled] = useState<ReadonlyArray<string>>([])
  const [signedIn, setSignedIn] = useState<ReadonlyArray<string>>([])
  const here = (found: Found, agent: AgentId): Here => {
    if (found.sources[0] === 'project') return agent === 'claude' ? 'in' : 'project'
    if (DIFFERS[found.id]?.[agent] !== undefined && agent !== 'claude' && !settled.includes(found.id)) return 'differs'
    if (found.sources.includes(agent)) return 'in'
    if (!(added[found.id] ?? []).includes(agent)) return 'missing'
    return SIGNS_IN.has(found.id) && !signedIn.includes(`${found.id}:${agent}`) ? 'signIn' : 'in'
  }
  const add = (found: Found, agents: ReadonlyArray<AgentId>) =>
    setAdded((now) => ({ ...now, [found.id]: [...new Set([...(now[found.id] ?? []), ...agents])] }))
  const remove = (found: Found, agent: AgentId) =>
    setAdded((now) => ({ ...now, [found.id]: (now[found.id] ?? []).filter((one) => one !== agent) }))
  const missing = (found: Found) => AGENTS.filter((agent) => here(found, agent.id) === 'missing').map((agent) => agent.id)
  const addAll = () => {
    for (const found of SERVERS) add(found, missing(found))
  }
  const signIn = (found: Found, agent: AgentId) => setSignedIn((now) => [...now, `${found.id}:${agent}`])
  const settle = (found: Found) => setSettled((now) => [...now, found.id])
  return { here, add, remove, missing, addAll, signIn, settle }
}
export type Sync = ReturnType<typeof useSync>

export const syncText = {
  inAlthar: 'In Althar',
  inAgents: 'In your agents',
  why: 'In Althar, each role gets what’s ticked, whichever agent it was found in. Syncing writes a server into your agents’ own settings, for when you use them on their own.',
  drift: (n: number) => `${n} servers aren’t in all three of your agents.`,
  addAll: 'Add them all',
  addTo: (names: string) => `Add to ${names}`,
  signIn: 'Sign in',
  differs: 'Differs',
  project: 'In althar’s .mcp.json, which only Claude Code reads',
  keep: 'Keep your agents’ servers the same',
  keepNote: 'A server you add or change in one of them goes to the others too.',
  wouldAdd: 'Turning it on adds 2 servers to Claude Code, 4 to Codex and 5 to OpenCode.',
  settle: 'To settle',
}

const names = (agents: ReadonlyArray<AgentId>) => {
  const list = AGENTS.filter((one) => agents.includes(one.id)).map((one) => one.name)
  return list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`
}

/** How the two differ, and one to keep in every agent. */
function DiffersMenu({ found, sync }: { found: Found; sync: Sync }) {
  const ways = DIFFERS[found.id] ?? {}
  return (
    <Menu
      label={`${found.name} differs`}
      width={340}
      trigger={
        <button type="button" className={s.differs}>
          {syncText.differs}
        </button>
      }
    >
      <MenuGroup label="Run it everywhere as">
        {AGENTS.filter((agent) => ways[agent.id] !== undefined).map((agent) => (
          <MenuItem
            key={agent.id}
            lead={<BrandMark brand={agent.brand} size={12} />}
            description={<code className={s.way}>{ways[agent.id]}</code>}
            onSelect={() => sync.settle(found)}
          >
            {`${agent.name}’s`}
          </MenuItem>
        ))}
      </MenuGroup>
      <MenuSeparator />
      <MenuItem onSelect={() => sync.settle(found)}>Leave them as they are</MenuItem>
    </Menu>
  )
}

/** A: one agent's cell in a server's row: in its settings, missing, to sign in, or different. */
export function AgentCell({ found, agent, sync }: { found: Found; agent: (typeof AGENTS)[number]; sync: Sync }) {
  const here = sync.here(found, agent.id)
  if (here === 'project')
    return (
      <Tooltip label={syncText.project}>
        <span className={s.none} tabIndex={0}>
          –
        </span>
      </Tooltip>
    )
  if (here === 'differs') return <DiffersMenu found={found} sync={sync} />
  if (here === 'signIn')
    return (
      <LinkButton className={s.signIn} onClick={() => sync.signIn(found, agent.id)}>
        {syncText.signIn}
      </LinkButton>
    )
  return (
    <Checkbox.Root
      checked={here === 'in'}
      className={box.box}
      aria-label={`${found.name} in ${agent.name}`}
      onCheckedChange={(next) => (next === true ? sync.add(found, [agent.id]) : sync.remove(found, agent.id))}
    >
      <Checkbox.Indicator className={box.tick}>
        <Icon name="check" size={10} />
      </Checkbox.Indicator>
    </Checkbox.Root>
  )
}

/** B: each agent's mark beside the name: solid where it is, faint where it isn't; then a way to add it to the rest. */
export function AgentMarks({ found, sync, links }: { found: Found; sync: Sync; links: boolean }) {
  const missing = sync.missing(found)
  return (
    <span className={s.marks}>
      {AGENTS.map((agent) => {
        const here = sync.here(found, agent.id)
        const said =
          here === 'in'
            ? `In ${agent.name}`
            : here === 'missing'
              ? `Not in ${agent.name}`
              : here === 'signIn'
                ? `In ${agent.name}, to sign in`
                : here === 'differs'
                  ? `In ${agent.name}, run another way`
                  : syncText.project
        return (
          <Tooltip key={agent.id} label={said}>
            <span className={s.mark} data-here={here} tabIndex={0} aria-label={said}>
              <BrandMark brand={agent.brand} size={12} />
            </span>
          </Tooltip>
        )
      })}
      {links && AGENTS.some((agent) => sync.here(found, agent.id) === 'differs') && <DiffersMenu found={found} sync={sync} />}
      {links &&
        AGENTS.filter((agent) => sync.here(found, agent.id) === 'signIn').map((agent) => (
          <LinkButton key={agent.id} className={s.signIn} onClick={() => sync.signIn(found, agent.id)}>
            {`${syncText.signIn} in ${agent.name}`}
          </LinkButton>
        ))}
      {links && missing.length > 0 && (
        <LinkButton reveal className={s.addTo} onClick={() => sync.add(found, missing)}>
          {syncText.addTo(names(missing))}
        </LinkButton>
      )}
    </span>
  )
}

/** A and B, over the table: how many aren't everywhere, and all of them added at once. */
export function Drift({ sync, line }: { sync: Sync; line: boolean }) {
  const short = SERVERS.filter((one) => sync.missing(one).length > 0).length
  return (
    <p className={s.drift}>
      <span>{syncText.why}</span>
      {line && short > 0 && (
        <span className={s.driftLine}>
          {syncText.drift(short)}
          <LinkButton onClick={sync.addAll}>{syncText.addAll}</LinkButton>
        </span>
      )}
    </p>
  )
}

/** C: one switch that keeps them the same; on, what it couldn't do alone, to settle. */
export function KeepSame({ sync, on, onChange }: { sync: Sync; on: boolean; onChange: (on: boolean) => void }) {
  const github = SERVERS.find((one) => one.id === 'github')!
  const toSignIn = SERVERS.map((found) => ({ found, agents: AGENTS.filter((agent) => sync.here(found, agent.id) === 'signIn') })).filter(
    (one) => one.agents.length > 0,
  )
  const differs = AGENTS.some((agent) => sync.here(github, agent.id) === 'differs')
  return (
    <div className={s.keep}>
      <div className={s.keepRow}>
        <span className={s.keepText}>
          <span className={s.keepTitle}>{syncText.keep}</span>
          <span className={s.keepNote}>{on ? syncText.keepNote : syncText.wouldAdd}</span>
        </span>
        <Switch
          checked={on}
          label={syncText.keep}
          onChange={(next) => {
            onChange(next)
            if (next) sync.addAll()
          }}
        />
      </div>
      {on && (differs || toSignIn.length > 0) && (
        <div className={s.settle}>
          <span className={s.settleTitle}>{syncText.settle}</span>
          {differs && (
            <span className={s.settleRow}>
              <BrandMark brand={Brand.GitHub} size={13} />
              <span className={s.settleWhat}>
                <strong>github</strong> runs with npx in Claude Code and in Docker in Codex.
              </span>
              <Button size="small" variant="quiet" onClick={() => sync.settle(github)}>
                Use npx everywhere
              </Button>
            </span>
          )}
          {toSignIn.map(({ found, agents }) => (
            <span key={found.id} className={s.settleRow}>
              {found.brand !== undefined ? <BrandMark brand={found.brand} size={13} /> : <Icon name="plug" size={13} />}
              <span className={s.settleWhat}>
                <strong>{found.name}</strong> signs in on its own in each agent.
              </span>
              {agents.map((agent) => (
                <Button key={agent.id} size="small" variant="quiet" onClick={() => sync.signIn(found, agent.id)}>
                  {`Sign in to ${agent.name}`}
                </Button>
              ))}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
