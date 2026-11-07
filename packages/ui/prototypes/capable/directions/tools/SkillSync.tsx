// Scrappy, surface 3: one switch that keeps the same skills in each of the person's agents, as MCP servers' does, but lighter: a skill is a folder, so Althar links it into each agent's skill folder and moves or copies nothing. No sign-ins, no formats, no tokens: what's left to settle is a skill with one name and two versions.
import { useState } from 'react'

import { Icon } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { Button } from '../../../../src/primitives/Button/Button'
import { Tooltip } from '../../../../src/primitives/HoverCard/HoverCard'
import { Menu, MenuGroup, MenuItem, MenuSeparator } from '../../../../src/primitives/Menu/Menu'
import { Switch } from '../../../../src/primitives/Switch/Switch'
import { type Found, SKILLS, type SourceId } from './found'
import { type AgentId, AGENTS } from './Sync'
import s from './sync.module.css'

/** Where each agent reads the person's own skills. OpenCode reads Claude Code's folder too. */
const FOLDERS: Readonly<Record<AgentId, string>> = {
  claude: '~/.claude/skills',
  codex: '~/.agents/skills',
  opencode: '~/.config/opencode/skills',
}

/** Which agents see a skill kept in each place. */
const SEEN: Readonly<Partial<Record<SourceId, ReadonlyArray<AgentId>>>> = {
  mine: ['claude', 'opencode'],
  shared: ['codex'],
  opencodeSkills: ['opencode'],
  plugin: ['claude'],
  repository: ['claude', 'opencode'],
}

/** Not the person's own folders: a plugin's, the repository's, Althar's. Sync leaves them as they are. */
const apart = (found: Found) => found.sources.some((one) => one === 'plugin' || one === 'repository' || one === 'althar')

/** release-notes: one in Claude Code's folder and another, older, in Codex's. */
const TWO = 'release-notes'

export type SkillHere = 'in' | 'linked' | 'missing' | 'out' | 'differs' | 'apart'
const key = (found: Found, agent: AgentId) => `${found.id}:${agent}`
const seenBy = (found: Found) => [...new Set(found.sources.flatMap((one) => SEEN[one] ?? []))]

export const useSkillSync = () => {
  const [on, setOn] = useState(false)
  const [out, setOut] = useState<ReadonlyArray<string>>([])
  const [pick, setPick] = useState<AgentId | 'apart' | null>(null)
  const [asking, setAsking] = useState(false)
  const planned = (found: Found, agent: AgentId) =>
    !apart(found) &&
    !seenBy(found).includes(agent) &&
    !out.includes(key(found, agent)) &&
    (found.id !== TWO || pick === 'claude' || pick === 'codex')
  const here = (found: Found, agent: AgentId): SkillHere => {
    if (apart(found)) return seenBy(found).includes(agent) ? 'in' : 'apart'
    if (found.id === TWO && pick === null && agent !== 'opencode') return 'differs'
    if (seenBy(found).includes(agent)) return 'in'
    if (out.includes(key(found, agent))) return 'out'
    return on && planned(found, agent) ? 'linked' : 'missing'
  }
  const links = (agent: AgentId) => SKILLS.filter((found) => !apart(found) && !seenBy(found).includes(agent) && found.id !== TWO)
  const total = AGENTS.reduce((sum, agent) => sum + SKILLS.filter((found) => planned(found, agent.id)).length, 0)
  return {
    on,
    pick,
    asking,
    total,
    here,
    links,
    keepOut: (found: Found, agent: AgentId) => setOut((now) => [...new Set([...now, key(found, agent)])]),
    putBack: (found: Found, agent: AgentId) => setOut((now) => now.filter((one) => one !== key(found, agent))),
    choose: setPick,
    turn: (next: boolean) => (next ? setOn(true) : setAsking(true)),
    cancel: () => setAsking(false),
    stop: (takeBack: boolean) => {
      setOn(false)
      setAsking(false)
      if (takeBack) setOut([])
    },
  }
}
export type SkillSync = ReturnType<typeof useSkillSync>

export const skillText = {
  keep: 'Keep your agents’ skills the same',
  what: 'Althar links each of your skills into Claude Code’s, Codex’s and OpenCode’s skill folders. The skill stays where it is, so a change to it reaches every agent.',
  later: 'A skill you add to one later is linked into the others.',
  leaves: 'It leaves alone',
  leave: [
    'Each skill’s own folder: nothing is moved or copied.',
    'Skills from a plugin. They update with it, so they stay in Claude Code.',
    'The repository’s .claude/skills, which is the project’s to change.',
    'Althar’s own skills. Every role gets them in Althar already.',
  ],
  ignored: 'What a skill says only Claude Code understands, such as which tools it may use, the others ignore.',
  willLink: 'Links',
  linked: 'Linked',
  nothing: 'Has them all',
  settle: 'To settle',
  offWhat: (n: number) => `It linked ${n} skills into your agents’ folders. The links can stay, or come out.`,
  keepThem: 'Leave them',
  takeBack: 'Take them out',
}

function TwoMenu({ sync }: { sync: SkillSync }) {
  return (
    <Menu
      label="Which release-notes"
      width={340}
      align="end"
      trigger={
        <Button size="small" variant="quiet" trailingIcon="chevronD">
          Pick one
        </Button>
      }
    >
      <MenuGroup label="Use everywhere">
        <MenuItem
          lead={<BrandMark brand={AGENTS[0]!.brand} size={12} />}
          description="Changed 3 Nov"
          onSelect={() => sync.choose('claude')}
        >
          Claude Code’s
        </MenuItem>
        <MenuItem
          lead={<BrandMark brand={AGENTS[1]!.brand} size={12} />}
          description="Changed 12 Aug"
          onSelect={() => sync.choose('codex')}
        >
          Codex’s
        </MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuItem onSelect={() => sync.choose('apart')}>Keep both, as they are</MenuItem>
    </Menu>
  )
}

function Two({ sync }: { sync: SkillSync }) {
  if (sync.pick !== null) return null
  return (
    <span className={s.settleRow}>
      <Icon name="knowledge" size={13} />
      <span className={s.settleWhat}>
        <strong>release-notes</strong> is in Claude Code and in Codex, but they differ.
      </span>
      <TwoMenu sync={sync} />
    </span>
  )
}

function Folders({ sync, done }: { sync: SkillSync; done: boolean }) {
  return (
    <div className={s.files}>
      <span className={s.label}>{done ? skillText.linked : skillText.willLink}</span>
      <ul className={s.fileList}>
        {AGENTS.map((agent) => {
          const all = [
            ...sync.links(agent.id),
            ...(sync.pick === 'claude' || sync.pick === 'codex'
              ? SKILLS.filter((one) => one.id === TWO && agent.id !== sync.pick && agent.id !== 'opencode')
              : []),
          ]
          const going = all.filter((found) => sync.here(found, agent.id) !== 'out')
          const left = all.filter((found) => sync.here(found, agent.id) === 'out')
          return (
            <li key={agent.id} className={s.file}>
              <span className={s.fileWho}>
                <BrandMark brand={agent.brand} size={13} />
                <span className={s.fileName}>{agent.name}</span>
                <code className={s.filePath} title={FOLDERS[agent.id]}>
                  {FOLDERS[agent.id]}
                </code>
              </span>
              <span className={s.chips}>
                {going.length === 0 && left.length === 0 && <span className={s.nothing}>{skillText.nothing}</span>}
                {going.map((found) => (
                  <Tooltip
                    key={found.id}
                    label={done ? `Take ${found.name} out of ${agent.name}` : `Leave ${found.name} out of ${agent.name}`}
                  >
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
        })}
      </ul>
    </div>
  )
}

/** The card over the skills' table. Links only, so it turns on at once, and says what it does on the card. */
export function KeepSkills({ sync }: { sync: SkillSync }) {
  return (
    <div className={s.keep}>
      <div className={s.keepRow}>
        <span className={s.keepText}>
          <span className={s.keepTitle}>{skillText.keep}</span>
          <span className={s.keepNote}>{sync.on ? skillText.later : skillText.what}</span>
        </span>
        <Switch checked={sync.on && !sync.asking} label={skillText.keep} onChange={sync.turn} />
      </div>
      {sync.asking && (
        <div className={s.offRow}>
          <span className={s.settleWhat}>{skillText.offWhat(sync.total)}</span>
          <Button size="small" variant="quiet" onClick={sync.cancel}>
            Cancel
          </Button>
          <Button size="small" variant="quiet" onClick={() => sync.stop(true)}>
            {skillText.takeBack}
          </Button>
          <Button size="small" onClick={() => sync.stop(false)}>
            {skillText.keepThem}
          </Button>
        </div>
      )}
      {sync.on && !sync.asking && (
        <>
          {sync.pick === null && (
            <div className={s.settle}>
              <span className={s.label}>{skillText.settle}</span>
              <Two sync={sync} />
            </div>
          )}
          <Folders sync={sync} done />
        </>
      )}
      {!sync.on && (
        <div className={s.body}>
          <Folders sync={sync} done={false} />
          {sync.pick === null && (
            <div className={s.waits}>
              <Two sync={sync} />
            </div>
          )}
          <div className={s.leaves}>
            <span className={s.label}>{skillText.leaves}</span>
            <ul className={s.leaveList}>
              {skillText.leave.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className={s.copy}>{skillText.ignored}</p>
          </div>
        </div>
      )}
    </div>
  )
}

/** Each agent's mark beside a skill's name: solid where it sees it, faint where it doesn't. */
export function SkillMarks({ found, sync }: { found: Found; sync: SkillSync }) {
  return (
    <span className={s.marks}>
      {AGENTS.map((agent) => {
        const here = sync.here(found, agent.id)
        const said =
          here === 'in'
            ? `In ${agent.name}`
            : here === 'linked'
              ? `In ${agent.name}, linked by Althar`
              : here === 'out'
                ? `Kept out of ${agent.name}`
                : here === 'differs'
                  ? `In ${agent.name}, another version`
                  : here === 'apart'
                    ? `Not in ${agent.name}; left as it is`
                    : `Not in ${agent.name}`
        return (
          <Tooltip key={agent.id} label={said}>
            <span className={s.mark} data-here={here === 'linked' ? 'added' : here === 'apart' ? 'project' : here} aria-label={said}>
              <BrandMark brand={agent.brand} size={12} />
            </span>
          </Tooltip>
        )
      })}
    </span>
  )
}
