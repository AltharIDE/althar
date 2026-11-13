import { Brand, BrandMark, Icon } from '@althar/ui'
import type { ReactNode } from 'react'

import { AGENTS } from '../../../content/agents'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import s from './Connections.module.css'

/*
 * What Althar works with, in a console seamed as Flow's is: the agents it
 * runs, the code hosts and trackers it has connectors for
 * (packages/connectors: GitHub, GitLab, Bitbucket, Linear, Jira, Trello),
 * and any MCP server, each group by what it is for.
 */

interface Item {
  id: string
  name: string
  mark: ReactNode
}

const brand = (b: Brand) => <BrandMark brand={b} size={20} />

const GROUPS: ReadonlyArray<{ name: string; items: readonly Item[]; wide?: boolean }> = [
  { name: 'Agents', wide: true, items: AGENTS.map((a) => ({ id: a.id, name: a.name, mark: <AgentMark agent={a.id} size={20} /> })) },
  {
    name: 'Code',
    items: [
      { id: 'github', name: 'GitHub', mark: brand(Brand.GitHub) },
      { id: 'gitlab', name: 'GitLab', mark: brand(Brand.GitLab) },
      { id: 'bitbucket', name: 'Bitbucket', mark: brand(Brand.Bitbucket) },
    ],
  },
  {
    name: 'Issues',
    items: [
      { id: 'linear', name: 'Linear', mark: brand(Brand.Linear) },
      { id: 'jira', name: 'Jira', mark: brand(Brand.Jira) },
      { id: 'trello', name: 'Trello', mark: brand(Brand.Trello) },
      { id: 'github-issues', name: 'GitHub Issues', mark: brand(Brand.GitHub) },
    ],
  },
  { name: 'Everything else', items: [{ id: 'mcp', name: 'Any MCP server', mark: <Icon name="plug" size={20} /> }] },
]

export function Connections() {
  return (
    <ol className={s.wall} data-light="">
      {GROUPS.map((group, i) => (
        <li key={group.name} className={cx(s.cell, group.wide && s.wide)}>
          <h3 className={s.plate}>
            <b>{String(i + 1).padStart(2, '0')}</b> {group.name}
          </h3>
          <ul className={s.marks}>
            {group.items.map((item) => (
              <li key={item.id}>
                {item.mark}
                {item.name}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}
