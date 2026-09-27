import { Tabs } from 'radix-ui'
import { useId, useState, type ReactNode } from 'react'

import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { StepState } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { useShell, type DocRef, type StepRef } from '../Shell/Shell'
import { SidePanel, SidePanelBody, SidePanelTitle } from '../../primitives/SidePanel/SidePanel'
import { Track } from '../Step/Step'
import s from './StepPanel.module.css'

/*
 * A step's own thread, beside the task thread, with its own composer: what
 * you send goes to that step's agent, not the lead. A step run by several
 * agents at once has a tab for each, and one for all of them; what you send
 * from there reaches every one.
 */

/** Which of a step's threads is showing: all of its agents, or one, by model id. */
export type StepTab = 'all' | (string & {})

export interface StepPanelText {
  step: (n: number, of: number) => string
  reviewers: (n: number) => string
  all: string
  tabs: string
  instructions: (name: string) => string
  /** What happens to its result, with one agent and with several. */
  returns: (many: boolean) => string
  /** The composer's placeholder: who hears it, and that the lead does not. */
  placeholder: (to: string, toAll: boolean) => string
  /** Who hears it, for the placeholder. */
  toAll: string
  composeNote: string
  send: string
  message: string
}

export const stepPanelText: StepPanelText = {
  step: (n, of) => `step ${n} of ${of}`,
  reviewers: (n) => `${n} reviewers`,
  all: 'Both',
  tabs: 'Whose thread',
  instructions: (name) => `Instructions · ${name}`,
  returns: (many) => (many ? 'Combined into one list for the lead' : 'Returns a verdict and findings to the lead'),
  placeholder: (to, toAll) => `Message ${to}. Goes to ${toAll ? 'both' : 'this step'}, not the lead`,
  toAll: 'both reviewers',
  composeNote: 'The lead sees this as one line in the task thread',
  send: 'Send',
  message: 'Message the step',
}

export interface StepPanelProps {
  step: StepRef & { n: number; of: number }
  /** The agents running it. More than one gives each a tab, and one for all. */
  agents: readonly ModelInfo[]
  tab?: StepTab
  defaultTab?: StepTab
  onTabChange?: (tab: StepTab) => void
  /** The team's instructions for this kind of step, opened beside the thread. */
  instructions?: DocRef
  /** The thread for a tab: its turns, and what you sent. */
  body: (tab: StepTab) => ReactNode
  /** Send to the step's agent, or to each of them from the all tab. */
  onSend: (said: string, tab: StepTab) => void
  onClose: () => void
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
  onSend,
  onClose,
  text,
}: StepPanelProps) {
  const t = { ...stepPanelText, ...text }
  const { openDoc } = useShell()
  const many = agents.length > 1
  const [tab, setTab] = useControlled<StepTab>(tabProp, defaultTab ?? (many ? 'all' : (agents[0]?.id ?? 'all')), onTabChange)
  const [draft, setDraft] = useState('')
  const field = useId()
  const current = agents.find((a) => a.id === tab)
  const to = tab === 'all' ? t.toAll : many && current ? current.short : step.label
  const send = () => {
    const said = draft.trim()
    if (!said) return
    onSend(said, tab)
    setDraft('')
  }
  const single = agents[0]

  return (
    <SidePanel
      label={step.label}
      onClose={onClose}
      headClassName={s.head}
      head={
        <>
          <Track n={step.n} of={step.of} state={step.state === StepState.Done ? StepState.Done : StepState.Started} />
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
              {t.all}
            </Tabs.Trigger>
            {agents.map((m) => (
              <Tabs.Trigger key={m.id} value={m.id} className={s.tab}>
                <Model model={m} short />
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        )}
        <div className={s.meta}>
          {instructions ? (
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
      <div className={s.compose}>
        <textarea
          id={field}
          rows={2}
          className={s.field}
          value={draft}
          aria-label={t.message}
          placeholder={t.placeholder(to, many && tab === 'all')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className={s.foot}>
          <span className={s.note}>{t.composeNote}</span>
          <Button onClick={send} disabled={!draft.trim()} kbd="↵">
            {t.send}
          </Button>
        </div>
      </div>
    </SidePanel>
  )
}
