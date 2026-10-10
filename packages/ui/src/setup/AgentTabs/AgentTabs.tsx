import { Tabs } from 'radix-ui'
import type { ReactNode } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { BrandChip } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './AgentTabs.module.css'

/*
 * The agents on this machine, one at a time: a tab for each across the top
 * (a violet dot on one that needs the person), and under them the chosen
 * agent with its own settings, which the consumer composes: its Accounts,
 * and beside them what its new work starts on. Arrows move between the tabs, as Radix's
 * Tabs do. Nothing here says what runs on an agent: settings is calm.
 */

export interface AgentTab {
  id: string
  name: string
  brand?: Brand
  /** Under its name when chosen: Anthropic · 2.4.1. */
  line?: string
  /** Only the person can fix something on it: a dot on its tab. */
  yours?: boolean
}

export interface AgentTabsText {
  yours: string
}

export const agentTabsText: AgentTabsText = { yours: 'needs you' }

export interface AgentTabsProps {
  /** What the tabs are, for a screen reader: Agents. */
  label: string
  agents: readonly AgentTab[]
  /** The chosen agent's id. */
  value: string
  onValueChange: (id: string) => void
  /** The chosen agent's settings. */
  children: ReactNode
  /** Beside them, narrower: what its new work starts on. Under them where there is little room. */
  aside?: ReactNode
  /** At the row's end: a way to add an agent. */
  end?: ReactNode
  /** The chosen agent's name, as a heading at this rank. */
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<AgentTabsText>
}

/** One agent at a time, the agents as tabs, the chosen one's settings under them. */
export function AgentTabs({
  label,
  agents,
  value,
  onValueChange,
  children,
  aside,
  end,
  headingLevel = 3,
  className,
  text,
}: AgentTabsProps) {
  const t = { ...agentTabsText, ...text }
  const chosen = agents.find((agent) => agent.id === value)
  return (
    <Tabs.Root value={value} onValueChange={onValueChange} className={cx(s.tabs, className)}>
      <div className={s.row}>
        <Tabs.List aria-label={label} className={s.list}>
          {agents.map((agent) => (
            <Tabs.Trigger key={agent.id} value={agent.id} className={s.tab}>
              <BrandChip brand={agent.brand} size={24} className={s.chip} />
              <span>{agent.name}</span>
              {agent.yours && (
                <>
                  <span className={s.dot} aria-hidden="true" />
                  <VisuallyHidden>, {t.yours}</VisuallyHidden>
                </>
              )}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        {end}
      </div>
      {chosen && (
        <Tabs.Content value={chosen.id} className={s.panel}>
          <header className={s.head}>
            <BrandChip brand={chosen.brand} size={44} />
            <span className={s.words}>
              <Heading level={headingLevel} className={s.name}>
                {chosen.name}
              </Heading>
              {chosen.line && <span className={s.line}>{chosen.line}</span>}
            </span>
          </header>
          {aside === undefined ? (
            children
          ) : (
            <div className={s.body}>
              <div className={s.main}>{children}</div>
              <div className={s.aside}>{aside}</div>
            </div>
          )}
        </Tabs.Content>
      )}
    </Tabs.Root>
  )
}
