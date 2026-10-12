import { Tabs } from 'radix-ui'
import type { ReactNode } from 'react'

import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { StepState } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { SidePanel, SidePanelBody, SidePanelTitle } from '../../primitives/SidePanel/SidePanel'
import { useThreadShell, type DocRef, type StepRef } from '../Shell/Shell'
import { StepPosition } from '../Step/Step'
import s from './StepPanel.module.css'

/*
 * A step's own thread, beside the task thread, with its own composer: what
 * you send goes to that step's agent, not the lead. A step run by several
 * agents at once has a tab for each, and one for all of them; what you send
 * from there reaches every one. The composer is the consumer's (a Composer),
 * so it sends the way every composer does; `stepPanelText` has the words
 * that say who will hear it.
 */

/** Which of a step's threads is showing: all of its agents, or one, by model id. */
export type StepTab = 'all' | (string & {})

export interface StepPanelText {
  step: (n: number, of: number) => string
  reviewers: (n: number) => string
  /** The tab for every agent on the step. */
  all: (n: number) => string
  tabs: string
  instructions: (name: string) => string
  /** What happens to its result, with one agent and with several. */
  returns: (many: boolean) => string
  /** For the consumer's composer: its placeholder, saying who hears it and that the lead does not. */
  placeholder: (to: string) => string
  /** Who hears it from the tab for every agent, for the placeholder. */
  toAll: (n: number) => string
  /** For the consumer's composer: a note beside it. */
  composeNote: string
}

export const stepPanelText: StepPanelText = {
  step: (n, of) => `step ${n} of ${of}`,
  reviewers: (n) => `${n} reviewers`,
  all: (n) => (n === 2 ? 'Both' : 'All'),
  tabs: 'Whose thread',
  instructions: (name) => `Instructions · ${name}`,
  returns: (many) => (many ? 'Combined into one list for the lead' : 'Returns a verdict and findings to the lead'),
  placeholder: (to) => `Message ${to}. The lead does not hear it`,
  toAll: (n) => (n === 2 ? 'both reviewers' : `all ${n} reviewers`),
  composeNote: 'The lead sees this as one line in the task thread',
}

/** Who a message from this tab reaches, in words, for the composer's placeholder. */
export function stepAudience(tab: StepTab, step: StepRef, agents: readonly ModelInfo[], t: StepPanelText = stepPanelText): string {
  if (tab === 'all' && agents.length > 1) return t.toAll(agents.length)
  const one = agents.find((a) => a.id === tab)
  return agents.length > 1 && one ? one.short : step.label
}

export interface StepPanelProps {
  step: StepRef & { n: number; of: number }
  /** The agents running it. More than one gives each a tab, and one for all. */
  agents: readonly ModelInfo[]
  tab?: StepTab
  defaultTab?: StepTab
  onTabChange?: (tab: StepTab) => void
  /** The team's instructions for this kind of step, opened beside the thread when the host can open documents. */
  instructions?: DocRef
  /** The thread for a tab: its turns, and what you sent. */
  body: (tab: StepTab) => ReactNode
  /** Under the thread: the consumer's Composer, sending to the step's agent, or to each of them from the all tab. */
  composer?: ReactNode
  onClose: () => void
  className?: string
  text?: Partial<StepPanelText>
}

export function StepPanel({
  step,
  agents,
  tab: tabProp,
  defaultTab,
  onTabChange,
  instructions,
  body,
  composer,
  onClose,
  className,
  text,
}: StepPanelProps) {
  const t = { ...stepPanelText, ...text }
  const { openDoc } = useThreadShell()
  const many = agents.length > 1
  const [tab, setTab] = useControlled<StepTab>(tabProp, defaultTab ?? (many ? 'all' : (agents[0]?.id ?? 'all')), onTabChange)
  const single = agents[0]

  return (
    <SidePanel
      label={step.label}
      onClose={onClose}
      className={className}
      headClassName={s.head}
      head={
        <>
          <StepPosition n={step.n} of={step.of} state={step.state ?? StepState.Started} />
          <SidePanelTitle>{step.label}</SidePanelTitle>
          {!many && single && <Model model={single} short className={s.model} />}
          <span className={s.where}>
            {t.step(step.n, step.of)}
            {many && ` · ${t.reviewers(agents.length)}`}
          </span>
        </>
      }
    >
      <Tabs.Root value={tab} onValueChange={setTab} className={s.tabsRoot}>
        {many && (
          <Tabs.List className={s.tabs} aria-label={t.tabs}>
            <Tabs.Trigger value="all" className={s.tab}>
              {t.all(agents.length)}
            </Tabs.Trigger>
            {agents.map((m) => (
              <Tabs.Trigger key={m.id} value={m.id} className={s.tab}>
                <Model model={m} short />
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        )}
        <div className={s.meta}>
          {instructions && openDoc ? (
            <LinkButton onClick={() => openDoc(instructions)}>
              {t.instructions(instructions.path?.split('/').pop() ?? instructions.title ?? '')}
            </LinkButton>
          ) : (
            <span />
          )}
          <span>{t.returns(many)}</span>
        </div>
        {(many ? ['all', ...agents.map((a) => a.id)] : [tab]).map((v) => (
          <Tabs.Content key={v} value={v} className={s.content} tabIndex={-1}>
            <SidePanelBody className={s.body}>{body(v)}</SidePanelBody>
          </Tabs.Content>
        ))}
      </Tabs.Root>
      {composer && <div className={s.compose}>{composer}</div>}
    </SidePanel>
  )
}
