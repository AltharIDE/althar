// Scrappy, surface 4: MCP calls in a task's thread. Each says the server it went to; what acted on the outside world stands out of the folded work, as a line (A) or as a card with what it said (B). And #596's "could see" line, with the servers beside the skills.
import type { ReactNode } from 'react'

import { Brand } from '../../../../src/foundations/brands/brands'
import { Icon } from '../../../../src/foundations/Icon/Icon'
import { BrandMark } from '../../../../src/foundations/Marks/Marks'
import { ToolKind, ToolState } from '../../../../src/foundations/vocabulary'
import { Disclosure, DisclosureTrigger, Fold } from '../../../../src/primitives/Fold/Fold'
import { Tool } from '../../../../src/thread/Tool/Tool'
import { SERVERS, SKILLS, SOURCES } from './found'
import seen from './SkillsSeen.module.css'
import s from './tools.module.css'

/** What a server's tool does, in people's words, by its name; what isn't here says its own name. */
const WORDS: Record<string, { verb: string; target: (input: string) => string; acts?: boolean }> = {
  get_pull_request: { verb: 'Read', target: () => '#612' },
  get_pull_request_files: { verb: 'Read', target: () => '#612’s files' },
  get_issue: { verb: 'Read', target: () => 'DEV-188' },
  browser_take_screenshot: { verb: 'Took', target: () => 'a screenshot' },
  create_pull_request_review: { verb: 'Posted', target: () => 'a review on #612', acts: true },
  update_issue: { verb: 'Moved', target: () => 'DEV-188 to In Review', acts: true },
}

const SERVER_NAMES: Record<string, { name: string; brand?: Brand }> = {
  github: { name: 'GitHub', brand: Brand.GitHub },
  linear: { name: 'Linear', brand: Brand.Linear },
  playwright: { name: 'Playwright' },
}

export const mcpOf = (target: string) => {
  const match = /^mcp__([a-z0-9-]+)__([a-z0-9_]+)/i.exec(target)
  if (match === null) return null
  const server = SERVER_NAMES[match[1]!] ?? { name: match[1]! }
  const words = WORDS[match[2]!] ?? { verb: 'Used', target: () => match[2]! }
  return { server, tool: match[2]!, verb: words.verb, target: words.target(target), acts: words.acts === true }
}

const ServerName = ({ server }: { server: { name: string; brand?: Brand } }) => (
  <span className={s.server}>
    {server.brand !== undefined ? <BrandMark brand={server.brand} size={11} /> : <Icon name="plug" size={11} />}
    {server.name}
  </span>
)

/** An MCP call as a row of the work: the server, then what it did. One that acts reads stronger, in both directions. */
export function McpRow({ target, state }: { target: string; state?: ToolState }) {
  const call = mcpOf(target)!
  return (
    <div className={call.acts ? s.mcpActs : s.mcp}>
      <Tool
        kind={call.acts ? ToolKind.Comment : ToolKind.Mcp}
        verb={call.verb}
        target={call.target}
        state={state ?? ToolState.Done}
        meta={<ServerName server={call.server} />}
      />
    </div>
  )
}

/** What an act said, by its mark in the thread. */
const ACTS: Record<string, { server: string; what: ReactNode; said?: string; link: string; shots?: number }> = {
  '§act-review': {
    server: 'github',
    what: (
      <>
        Posted a review on <strong>#612</strong>, as balazs
      </>
    ),
    said: 'The tour’s second card sits 12px lower than its Storybook story, and its title wraps at 900px where the story’s doesn’t. Screenshots of both below.',
    link: 'https://github.com/AltharIDE/althar/pull/612#pullrequestreview-1',
    shots: 3,
  },
  '§act-linear': {
    server: 'linear',
    what: (
      <>
        Moved <strong>DEV-188</strong> to In Review
      </>
    ),
    link: 'https://linear.app/althar/issue/DEV-188',
  },
}

/** An act as a card: what it did and where, and what it said for the person. */
export function ActCard({ mark }: { mark: string }) {
  const act = ACTS[mark]
  if (act === undefined) return null
  return (
    <div className={s.actCard}>
      <p className={s.actHead}>
        <ServerName server={SERVER_NAMES[act.server]!} />
        <span className={s.actWhat}>{act.what}</span>
        <a className={s.actOpen} href={act.link} target="_blank" rel="noreferrer">
          Open
        </a>
      </p>
      {act.said !== undefined && <p className={s.actSaid}>{act.said}</p>}
      {act.shots !== undefined && <p className={s.actMore}>{`${act.shots} screenshots`}</p>}
    </div>
  )
}

/** #596's line, saying the servers too: what the lead's agent could see, opened by whose. */
export function Seen({ agent }: { agent: string }) {
  const groups = [
    { label: 'MCP servers', names: SERVERS.filter((one) => one.roles.includes('lead')).map((one) => one.name) },
    { label: 'Yours', names: SKILLS.filter((one) => one.sources[0] === 'mine').map((one) => one.name) },
    { label: SOURCES.plugin.name, names: SKILLS.filter((one) => one.sources[0] === 'plugin').map((one) => one.name) },
    { label: 'This repository', names: SKILLS.filter((one) => one.sources[0] === 'repository').map((one) => one.name) },
    { label: 'Althar’s', names: SKILLS.filter((one) => one.sources[0] === 'althar').map((one) => one.name) },
  ]
  const skills = SKILLS.length
  const servers = groups[0]!.names.length
  return (
    <Disclosure className={seen.seen}>
      <DisclosureTrigger>
        <button type="button" className={seen.row}>
          <span className={seen.mark}>
            <Icon name="chevron" size={11} className={seen.chevron} />
          </span>
          <span className={seen.title}>{`${agent} could see ${skills} skills and ${servers} MCP servers`}</span>
        </button>
      </DisclosureTrigger>
      <Fold>
        <div className={seen.groups}>
          {groups.map((group) => (
            <div key={group.label} className={seen.group}>
              <h4 className={seen.label}>{group.label}</h4>
              <ul className={seen.names}>
                {group.names.map((name) => (
                  <li key={name} className={seen.name}>
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Fold>
    </Disclosure>
  )
}
