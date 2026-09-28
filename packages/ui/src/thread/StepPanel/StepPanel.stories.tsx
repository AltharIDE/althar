import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Composer } from '../../composer/Composer/Composer'
import { reviewDoc, STEPS } from '../../fixtures/meridian'
import { GEMINI_PRO, SONNET } from '../../fixtures/models'
import type { ModelInfo } from '../../foundations/Model/Model'
import { ToolKind } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { Thread } from '../Thread/Thread'
import { Tool } from '../Tool/Tool'
import { Prose, Turn } from '../Turn/Turn'
import { WorkedFor } from '../WorkedFor/WorkedFor'
import { You } from '../You/You'
import { stepAudience, StepPanel, stepPanelText, type StepTab } from './StepPanel'

const INSTRUCTIONS = { path: '.charrette/review.md', ...reviewDoc }
const SAID: Record<string, { took: string; summary: string; text: string }> = {
  [SONNET.id]: {
    took: '3m 50s',
    summary: 'read 6 files · 1 search',
    text: 'Two findings. The limiter runs after the idempotency lookup, so a replay spends budget; and refunds share the charges bucket, which will refuse refunds for a partner at full charge volume.',
  },
  [GEMINI_PRO.id]: {
    took: '4m 20s',
    summary: 'read 5 files',
    text: 'Two findings. Same one on limiter order; and the reset test waits on the wall clock. The shared bucket matches the spec, so I did not flag it.',
  },
}

function Said({ model }: { model: ModelInfo }) {
  const said = SAID[model.id]
  if (!said) return null
  return (
    <Turn model={model} at="2h ago">
      <WorkedFor took={said.took} summary={said.summary}>
        <Tool kind={ToolKind.Read} verb="Read" target="src/refunds/router.ts" meta="151 lines" />
        <Tool kind={ToolKind.Read} verb="Read" target="src/charges/limit.ts" meta="88 lines" />
      </WorkedFor>
      <Prose>{said.text}</Prose>
    </Turn>
  )
}

const REVIEWERS = [SONNET, GEMINI_PRO]

/** The body a host renders for a tab: each agent's turns, then what you sent there, as a Thread. */
function Body({ tab, sent }: { tab: StepTab; sent: { said: string; tab: StepTab }[] }) {
  const shown = tab === 'all' ? REVIEWERS : REVIEWERS.filter((m) => m.id === tab)
  return (
    <Thread label={tab === 'all' ? 'Both reviewers' : (shown[0]?.name ?? '')}>
      {shown.map((m) => (
        <Said key={m.id} model={m} />
      ))}
      {sent
        .filter((x) => x.tab === tab || x.tab === 'all')
        .map((x, i) => (
          <You key={i} at="sent to the step">
            {x.said}
          </You>
        ))}
    </Thread>
  )
}

/** A host that keeps what you sent, with its own composer in the panel. Beside a thread, or alone in a cell. */
function Hosted({ agents = REVIEWERS, defaultTab, alone }: { agents?: ModelInfo[]; defaultTab?: StepTab; alone?: boolean }) {
  const step = agents.length > 1 ? STEPS.review : STEPS.security
  const [tab, setTab] = useState<StepTab>(defaultTab ?? (agents.length > 1 ? 'all' : (agents[0]?.id ?? 'all')))
  const [draft, setDraft] = useState('')
  const [sent, setSent] = useState<{ said: string; tab: StepTab }[]>([])
  return (
    <div style={alone ? { height: 560, display: 'grid' } : { height: '100vh', display: 'grid', gridTemplateColumns: '1fr 520px' }}>
      {!alone && <div />}
      <StepPanel
        step={step}
        agents={agents}
        tab={tab}
        onTabChange={setTab}
        instructions={INSTRUCTIONS}
        body={(t) => <Body tab={t} sent={sent} />}
        composer={
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={(said) => {
              setSent([...sent, { said, tab }])
              setDraft('')
            }}
            placeholder={stepPanelText.placeholder(stepAudience(tab, step, agents))}
          />
        }
        onClose={fn()}
      />
    </div>
  )
}

const meta = {
  title: 'Thread/StepPanel',
  component: StepPanel,
  parameters: { layout: 'fullscreen' },
  args: { step: STEPS.review, agents: REVIEWERS, body: () => null, onClose: fn() },
} satisfies Meta<typeof StepPanel>
export default meta
type Story = StoryObj<typeof meta>

/** Two reviewers: a tab for each and one for both. Enter sends; what you send lands in the tabs it went to. */
export const TwoReviewers: Story = {
  render: () => <Hosted />,
}

/** Switching reviewer and messaging it. */
export const MessagingAReviewer: Story = {
  render: () => <Hosted />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('tab', { name: /Gemini 3 Pro/ }))
    const field = c.getByRole('textbox', { name: 'Message Gemini 3 Pro. The lead does not hear it' })
    await userEvent.type(field, 'Check the webhook retry path too')
    await userEvent.click(c.getByRole('button', { name: /Send/ }))
    await expect(c.getByText('Check the webhook retry path too')).toBeInTheDocument()
  },
}

/** One agent: no tabs; the model is named in the head. */
export const OneAgent: Story = { render: () => <Hosted agents={[SONNET]} /> }

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'both reviewers', node: <Hosted alone /> },
        { state: 'one reviewer’s tab', node: <Hosted alone defaultTab={GEMINI_PRO.id} /> },
        { state: 'one agent', node: <Hosted alone agents={[SONNET]} /> },
      ]}
    />
  ),
}
