import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useState, type ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Composer } from '../../composer/Composer/Composer'
import { FINDINGS_SETTLED, reviewDoc, STEPS, summaryDoc } from '../../fixtures/meridian'
import { GEMINI_PRO, OPUS, SONNET } from '../../fixtures/models'
import { Delivery, StepState, Verdict } from '../../foundations/vocabulary'
import { DocPanel } from '../DocPanel/DocPanel'
import { Document } from '../Document/Document'
import { Review } from '../Review/Review'
import { ThreadShellProvider, type DocRef, type StepRef, type ThreadShell } from '../Shell/Shell'
import { StepPanel } from '../StepPanel/StepPanel'
import { Thread } from '../Thread/Thread'
import { Prose, Turn } from '../Turn/Turn'
import { You } from '../You/You'
import { TaskFace } from './TaskFace'

interface Said {
  id: number
  you?: boolean
  text: string
  queued?: boolean
}

/*
 * The host a product would write: which panel is open, what sending does.
 * A document and a step's thread share the one panel; Escape closes it
 * (SidePanel hears Escape first).
 */
function Face({ busy, children, initialDoc }: { busy?: boolean; children: ReactNode; initialDoc?: DocRef }) {
  const [doc, setDoc] = useState<DocRef | null>(initialDoc ?? null)
  const [step, setStep] = useState<StepRef | null>(null)
  const [draft, setDraft] = useState('')
  const [said, setSaid] = useState<Said[]>([])
  const shell = useMemo<ThreadShell>(
    () => ({
      openDoc: (d) => {
        setStep(null)
        setDoc(d)
      },
      openImage: () => {},
      openStep: (st) => {
        setDoc(null)
        setStep(st)
      },
    }),
    [],
  )
  const send = (text: string) => {
    setDraft('')
    setSaid((v) => [
      ...v,
      { id: v.length, you: true, text, queued: busy },
      ...(busy ? [] : [{ id: v.length + 1, text: 'Understood. I’ll take that into what I do next and say here what changed.' }]),
    ])
  }
  const panel = doc ? (
    <DocPanel doc={doc} onClose={() => setDoc(null)} />
  ) : step ? (
    <StepPanel
      step={{ ...STEPS.review, ...step }}
      agents={[SONNET, GEMINI_PRO]}
      instructions={{ path: '.althar/review.md', ...reviewDoc }}
      body={() => <Prose>Both reviewers read the router and the limiter.</Prose>}
      composer={<Composer value="" onChange={() => {}} onSubmit={() => {}} placeholder="Tell the reviewers" />}
      onClose={() => setStep(null)}
    />
  ) : undefined
  return (
    <ThreadShellProvider value={shell}>
      <div style={{ height: '100vh' }}>
        <TaskFace
          panel={panel}
          composer={<Composer value={draft} onChange={setDraft} onSubmit={send} busy={busy} placeholder="Tell the lead" hint="/" />}
        >
          <Thread label="Task 432" busy={busy}>
            {children}
            {said.map((m) =>
              m.you ? (
                <You key={m.id} at="just now" delivery={m.queued ? Delivery.Queued : Delivery.Delivered}>
                  {m.text}
                </You>
              ) : (
                <Turn key={m.id} model={OPUS} at="just now">
                  <Prose>{m.text}</Prose>
                </Turn>
              ),
            )}
          </Thread>
        </TaskFace>
      </div>
    </ThreadShellProvider>
  )
}

const THREAD = (
  <>
    <You at="11:02">Backfill idempotency keys on refunds created before PR 1184. Dry run first.</You>
    <Turn model={OPUS} at="11:40">
      <Prose>The backfill is written and the dry run is clean on 18,402 refunds. Two reviewers are reading it now.</Prose>
      <Document {...summaryDoc} />
    </Turn>
    <Review
      n={3}
      of={6}
      reviewers={[{ model: SONNET }, { model: GEMINI_PRO }]}
      verdict={Verdict.Changes}
      took="4m 20s"
      thread={STEPS.review}
      defaultFindings={FINDINGS_SETTLED}
      state={StepState.Done}
    />
    <Turn model={OPUS} at="11:52">
      <Prose>Fixed both findings the reviewers agreed on and set the third aside, with the reason. Opening the draft PR next.</Prose>
    </Turn>
  </>
)

const meta = {
  title: 'Thread/TaskFace',
  component: TaskFace,
  parameters: { layout: 'fullscreen' },
  args: { children: null, composer: null },
} satisfies Meta<typeof TaskFace>
export default meta
type Story = StoryObj<typeof meta>

/** Sending while the lead is idle: it answers. */
export const Idle: Story = {
  render: () => <Face>{THREAD}</Face>,
}

/** Sending a message, and the lead answering. */
export const Sending: Story = {
  render: () => <Face>{THREAD}</Face>,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.type(c.getByRole('textbox', { name: 'Tell the lead' }), 'Keep the dry run output{Enter}')
    await waitFor(() => expect(c.getByText(/Understood/)).toBeInTheDocument())
  },
}

/** While the lead works, what you send waits at the end of the thread until the lead is done with what it is doing. */
export const Busy: Story = { render: () => <Face busy>{THREAD}</Face> }

/** A document opens beside the thread, not over it. */
export const WithDocument: Story = { render: () => <Face initialDoc={summaryDoc}>{THREAD}</Face> }

/** The review's thread opens in the same place. */
export const WithStep: Story = {
  render: () => <Face>{THREAD}</Face>,
}

/** Opening a step’s thread beside the task’s. */
export const OpeningAStep: Story = {
  render: () => <Face>{THREAD}</Face>,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getAllByRole('button', { name: /thread/i })[0]!)
    await waitFor(() => expect(c.getByRole('tablist')).toBeInTheDocument())
  },
}
