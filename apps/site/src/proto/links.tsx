import { Brand, BrandMark, Icon, Logo } from '@althar/ui'
import type { CSSProperties, ReactNode } from 'react'

import { cx } from '../lib/cx'
import { Station } from '../home/bodies/desktop/DesktopBody'
import { AgentMark } from '../shared/AgentMark'
import { AGENTS, Agent } from '../content/agents'
import type { Direction } from './board'
import s from './links.module.css'

/*
 * Everything Althar connects to, while where and how it is shown is chosen:
 * the agents it runs, the code hosts and trackers it has connectors for
 * (packages/connectors: GitHub, GitLab, Bitbucket, Linear, Jira, Trello),
 * and any MCP server.
 */

export interface Links {
  /** Where it stands: a band under Runs on, or a station after another. */
  where: 'band' | 'independent' | 'review' | 'flow'
  node: ReactNode
}

interface Service {
  id: string
  name: string
  mark: ReactNode
}

const mark = (brand: Brand, size = 20) => <BrandMark brand={brand} size={size} />

const CODE: Service[] = [
  { id: 'github', name: 'GitHub', mark: mark(Brand.GitHub) },
  { id: 'gitlab', name: 'GitLab', mark: mark(Brand.GitLab) },
  { id: 'bitbucket', name: 'Bitbucket', mark: mark(Brand.Bitbucket) },
]
const ISSUES: Service[] = [
  { id: 'linear', name: 'Linear', mark: mark(Brand.Linear) },
  { id: 'jira', name: 'Jira', mark: mark(Brand.Jira) },
  { id: 'trello', name: 'Trello', mark: mark(Brand.Trello) },
  { id: 'github-issues', name: 'GitHub Issues', mark: mark(Brand.GitHub) },
]
const MCP: Service = { id: 'mcp', name: 'Any MCP server', mark: <Icon name="plug" size={20} /> }
const SHOWN_AGENTS = AGENTS.filter((a) => a.id !== Agent.Gemini && a.id !== Agent.Cursor)
const AGENT_SERVICES: Service[] = SHOWN_AGENTS.map((a) => ({ id: a.id, name: a.name, mark: <AgentMark agent={a.id} size={20} /> }))

const SCENE = {
  title: (
    <>
      Works with
      <br />
      <b>what you already use.</b>
    </>
  ),
  lead: 'Code on GitHub, GitLab or Bitbucket. Issues in Linear, Jira or Trello. Anything else through an MCP server. Connect each once, and every agent can use it.',
}
const STAMP = { no: '06', name: 'Connections', km: 10 }

/** A: one more line under Runs on, as it is drawn. */
function Band() {
  const all = [...CODE, ...ISSUES.filter((x) => x.id !== 'github-issues'), MCP]
  return (
    <section id="links" className={s.band} aria-label="Connects to GitHub, GitLab, Bitbucket, Linear, Jira, Trello and any MCP server">
      <span className={s.bandLabel}>Connects to</span>
      {all.map((x, i) => (
        <span key={x.id} className={s.bandItem}>
          {i > 0 && <i className={s.dot} aria-hidden="true" />}
          {x.mark}
          {x.name}
        </span>
      ))}
    </section>
  )
}

/** B: a station of its own, the services in a console by what they are for. */
function Wall() {
  const groups: Array<{ name: string; items: Service[]; wide?: boolean }> = [
    { name: 'Agents', items: AGENT_SERVICES, wide: true },
    { name: 'Code', items: CODE },
    { name: 'Issues', items: ISSUES },
    { name: 'Everything else', items: [MCP] },
  ]
  return (
    <Station id="links" layout="bank" stamp={STAMP} scene={SCENE}>
      <ol className={s.wall} data-light="">
        {groups.map((g, i) => (
          <li key={g.name} className={cx(s.cell, g.wide && s.wide)}>
            <span className={s.plate}>
              <b>{String(i + 1).padStart(2, '0')}</b> {g.name}
            </span>
            <ul className={s.marks}>
              {g.items.map((x) => (
                <li key={x.id}>
                  {x.mark}
                  {x.name}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </Station>
  )
}

/** C: a station, Althar at the middle of a small system, the services on its rings as the first screen's agents are. */
function Orbit() {
  const inner = [...CODE, MCP]
  const outer = ISSUES.filter((x) => x.id !== 'github-issues')
  const ring = (items: Service[], rx: number, ry: number, turn: number) =>
    items.map((x, i) => {
      const a = turn + (i / items.length) * Math.PI * 2
      return (
        <span
          key={x.id}
          className={s.body}
          style={{ '--x': `${50 + rx * Math.cos(a)}%`, '--y': `${50 + ry * Math.sin(a)}%` } as CSSProperties}
        >
          <span className={s.planet}>{x.mark}</span>
          <span className={s.name}>{x.name}</span>
        </span>
      )
    })
  return (
    <Station id="links" layout="wide" stamp={STAMP} scene={SCENE}>
      <div className={s.orbit} data-light="">
        <i className={s.ring} style={{ '--rx': '24%', '--ry': '22%' } as CSSProperties} />
        <i className={s.ring} style={{ '--rx': '40%', '--ry': '36%' } as CSSProperties} />
        <span className={s.sun}>
          <Logo size={40} />
        </span>
        {ring(inner, 24, 22, -Math.PI / 4)}
        {ring(outer, 40, 36, Math.PI / 6)}
      </div>
    </Station>
  )
}

/** D: under the board, a quiet row of large marks between hairlines, no names but on hover, agents and services alike. */
function Row() {
  const services = [...CODE, ...ISSUES.filter((x) => x.id !== 'github-issues')]
  return (
    <section id="links" className={s.rowStation} aria-label="Works with the agents and services you already use">
      <p className={s.rowLabel}>Works with the agents and tools you already use</p>
      <ul className={s.row}>
        {AGENT_SERVICES.map((x) => (
          <li key={x.id} title={x.name}>
            {x.mark}
          </li>
        ))}
      </ul>
      <ul className={cx(s.row, s.rowServices)}>
        {services.map((x) => (
          <li key={x.id} title={x.name}>
            {x.mark}
            <span>{x.name}</span>
          </li>
        ))}
        <li title={MCP.name}>
          {MCP.mark}
          <span>MCP</span>
        </li>
      </ul>
    </section>
  )
}

export const LINKS: Direction<Links>[] = [
  { key: 'a', name: 'A band under Runs on', value: { where: 'band', node: <Band /> } },
  { key: 'b', name: 'A station after Flow: a console, by what each is for', value: { where: 'flow', node: <Wall /> } },
  { key: 'c', name: 'A station after Flow: a small orrery', value: { where: 'flow', node: <Orbit /> } },
  { key: 'd', name: 'A row of marks under the board', value: { where: 'independent', node: <Row /> } },
]
