import { Tabs } from 'radix-ui'
import { Fragment, type ReactNode } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { BrandChip } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './AgentTabs.module.css'

/*
 * The agents on this machine, one at a time: a small tab for each (a violet
 * dot on one that needs the person), which sits wherever the consumer puts
 * it, such as the head of the module it opened from; and the chosen agent
 * on a lighter sheet, its name and who makes it on one line, then its own
 * settings, which the consumer composes: its Accounts, and beside them, in
 * a narrower column, what its new work starts on. AgentTabs holds which one
 * is chosen, around both; arrows move between the tabs, as Radix's Tabs do.
 * Nothing here says what runs on an agent: settings is calm. The agents
 * not on this machine come after a thin rule, their tabs quieter, so those
 * that work now stand first however many more there are.
 */

export interface AgentTab {
  id: string
  name: string
  brand?: Brand
  /** Beside its name when chosen: Anthropic · 2.4.1. */
  line?: string
  /** Only the person can fix something on it: a dot on its tab. */
  yours?: boolean
  /** It isn't on this machine: its tab quieter, after those that are. */
  away?: boolean
}

export interface AgentTabsProps {
  /** The chosen agent's id. */
  value: string
  onValueChange: (id: string) => void
  /** An AgentTabList and an AgentTabPanel, wherever they sit inside. */
  children: ReactNode
  className?: string
}

/** One agent at a time: which is chosen, around its tabs and its settings. */
export function AgentTabs({ value, onValueChange, children, className }: AgentTabsProps) {
  return (
    <Tabs.Root value={value} onValueChange={onValueChange} className={className}>
      {children}
    </Tabs.Root>
  )
}

export interface AgentTabListText {
  yours: string
  /** Said after an agent's name where it isn't on this machine. */
  away: string
}

export const agentTabListText: AgentTabListText = { yours: 'needs you', away: 'not on this Mac' }

export interface AgentTabListProps {
  /** What the tabs are, for a screen reader: Agents. */
  label: string
  agents: readonly AgentTab[]
  className?: string
  text?: Partial<AgentTabListText>
}

/** The agents as small tabs, a mark and a name each. */
export function AgentTabList({ label, agents, className, text }: AgentTabListProps) {
  const t = { ...agentTabListText, ...text }
  return (
    <Tabs.List aria-label={label} className={cx(s.list, className)}>
      {agents.map((agent, at) => (
        <Fragment key={agent.id}>
          {/* A thin rule between those on this machine and the rest. */}
          {agent.away && at > 0 && !agents[at - 1]?.away && <span className={s.split} aria-hidden="true" />}
          <Tabs.Trigger value={agent.id} className={cx(s.tab, agent.away && s.away)}>
            <BrandChip brand={agent.brand} size={18} className={s.chip} />
            <span>{agent.name}</span>
            {agent.away && <VisuallyHidden>, {t.away}</VisuallyHidden>}
            {agent.yours && (
              <>
                <span className={s.dot} aria-hidden="true" />
                <VisuallyHidden>, {t.yours}</VisuallyHidden>
              </>
            )}
          </Tabs.Trigger>
        </Fragment>
      ))}
    </Tabs.List>
  )
}

export interface AgentTabPanelProps {
  /** The chosen agent. */
  agent: AgentTab
  /** Its settings. */
  children: ReactNode
  /** Beside them, narrower: what its new work starts on. Under them where there is little room. */
  aside?: ReactNode
  /** The agent's name, as a heading at this rank. */
  headingLevel?: HeadingLevel
  className?: string
}

/** The chosen agent's settings, on a lighter sheet: its name and who makes it on one line, then what the consumer gives. */
export function AgentTabPanel({ agent, children, aside, headingLevel = 3, className }: AgentTabPanelProps) {
  return (
    <Tabs.Content value={agent.id} className={cx(s.panel, className)}>
      <header className={s.head}>
        <Heading level={headingLevel} className={s.name}>
          {agent.name}
        </Heading>
        {agent.line && <span className={s.line}>{agent.line}</span>}
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
  )
}
