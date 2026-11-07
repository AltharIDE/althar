import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { Behind } from '../../composer/Behind/Behind'
import { Brand } from '../../foundations/brands/brands'
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

/** The end of the thread clears everything on the composer's edge: the chip, a notice and its Keep link. At the bottom, the last message ends above the chip. */
export const LastMessageClearsTheEdge: Story = {
  render: () => (
    <div style={{ height: 420, width: 360 }}>
      <TaskFace
        composer={
          <Composer
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            placeholder="Tell the lead"
            above={<Behind sources={[{ id: 'pr', mark: Brand.GitHub, label: 'PR 1206', what: 'review comments and checks' }]} />}
            notice={
              <>
                <div role="alert">
                  The agent stopped: the repository moved. <button type="button">Dismiss</button>
                </div>
                <div>
                  GPT-6.1 Sol takes over from Claude Opus 5 when you send. <button type="button">Keep Claude Opus 5</button>
                </div>
              </>
            }
          />
        }
      >
        <Thread label="Task 432">
          {THREAD}
          <Turn model={OPUS} at="12:01">
            <Prose>This is the last message.</Prose>
          </Turn>
        </Thread>
      </TaskFace>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const host = canvasElement.querySelector<HTMLElement>('[data-floats-host]')!
    await waitFor(() => expect(host.style.getPropertyValue('--composer-floats')).not.toBe(''))
    const last = c.getByText('This is the last message.')
    const chip = canvasElement.querySelector('button[aria-expanded]')!
    const alert = c.getByRole('alert')
    const keep = c.getByRole('button', { name: /^Keep/ })
    // Boxes exist only in a browser; jsdom draws none, so the geometry is asserted there alone.
    if (chip.getBoundingClientRect().width === 0) return
    host.querySelector('[class*="scroll"]')?.scrollTo({ top: 1e6 })
    await waitFor(() =>
      expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        Math.min(chip.getBoundingClientRect().top, alert.getBoundingClientRect().top),
      ),
    )
    await expect(chip.getBoundingClientRect().bottom).toBeLessThanOrEqual(alert.getBoundingClientRect().top)
    await expect(alert.getBoundingClientRect().bottom).toBeLessThanOrEqual(keep.getBoundingClientRect().top)
  },
}

const LONG = (
  <>
    {THREAD}
    {Array.from({ length: 6 }, (_, i) => (
      <Turn key={i} model={OPUS} at={`12:${10 + i}`}>
        <Prose>Checked another batch of refunds against the keys: nothing to change, the dry run still matches the ledger.</Prose>
      </Turn>
    ))}
  </>
)
const PR_PILL = { id: 'pr', mark: Brand.GitHub, label: 'PR #317', what: 'review comments and checks' }
const TWO_PROCESSES = [
  { id: 'site', name: 'Site dev server', command: 'bun run dev', url: 'localhost:5173', since: '41m' },
  { id: 'sb', name: 'Storybook', command: 'bun run storybook', url: 'localhost:6116', since: '22m' },
]

/* The thread's scroller: the one inside the face that has more to scroll than it shows. */
const scrollerOf = (root: HTMLElement | null) =>
  Array.from(root?.querySelectorAll<HTMLElement>('[data-floats-host] *') ?? []).find(
    (el) => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight,
  )

/* Scrolls the thread inside it to the top once it has a size, as a reader scrolling up would. */
function ReadingUp({ children, width = 640 }: { children: ReactNode; width?: number }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // after the thread has settled at its end, so the following doesn't take the reader back down
    const timer = setTimeout(() => scrollerOf(box.current)?.scrollTo({ top: 0 }), 400)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div ref={box} style={{ height: 520, width }}>
      {children}
    </div>
  )
}

/* The thread scrolled up to read, so the Latest pill shows, over a composer with `above` on its edge (and a notice, if given). */
function scrolledUp(above?: ReactNode, opts: { width?: number; notice?: string } = {}): Story {
  return {
    render: () => (
      <ReadingUp width={opts.width}>
        <TaskFace
          composer={
            <Composer value="" onChange={() => {}} onSubmit={() => {}} placeholder="Tell the lead" above={above} notice={opts.notice} />
          }
        >
          <Thread label="Task 432">{LONG}</Thread>
        </TaskFace>
      </ReadingUp>
    ),
    play: async ({ canvasElement }) => {
      const c = within(canvasElement)
      // Needs layout, so these stories are in BROWSER_ONLY (tests/stories.ts): jsdom draws no boxes.
      const scroller = scrollerOf(canvasElement)
      await expect(scroller).toBeTruthy()
      scroller!.scrollTo({ top: 0 })
      const jump = await c.findByRole('button', { name: /latest/i })
      // What floats on the edge is one box, however its pills wrap; its top is what the pill must clear.
      const floats = canvasElement.querySelector('[class*="floats"]')!
      if (above || opts.notice) {
        await expect(floats.childElementCount).toBeGreaterThan(0)
        await expect(jump.getBoundingClientRect().bottom).toBeLessThan(floats.getBoundingClientRect().top)
      } else {
        await expect(floats.childElementCount).toBe(0)
      }
    },
  }
}

/** Scrolled up with nothing on the composer's edge: the pill keeps its place just above the composer. */
export const ScrolledUp: Story = scrolledUp()
export const ScrolledUpDark: Story = { ...ScrolledUp, globals: { theme: 'dark' } }

/** One pill on the composer's edge ("Listening to PR #317"): the Latest pill rests above it, not on it. */
export const ScrolledUpWithOnePill: Story = scrolledUp(<Behind sources={[PR_PILL]} />)
export const ScrolledUpWithOnePillDark: Story = { ...ScrolledUpWithOnePill, globals: { theme: 'dark' } }

/** Two pills ("Listening to PR #317", "Running 2 processes"): the Latest pill clears both. */
export const ScrolledUpWithTwoPills: Story = scrolledUp(<Behind sources={[PR_PILL]} processes={TWO_PROCESSES} />)
export const ScrolledUpWithTwoPillsDark: Story = { ...ScrolledUpWithTwoPills, globals: { theme: 'dark' } }

/** Two things on the edge (a PR chip and a processes chip) and a notice, in a narrow composer: the row wraps, grows taller, and the Latest pill still clears it. */
export const ScrolledUpWrapped: Story = scrolledUp(
  <>
    <Behind sources={[PR_PILL]} />
    <Behind processes={TWO_PROCESSES} />
  </>,
  { width: 300, notice: 'Sending hands this to the lead, who takes over from here and reads what you wrote before it carries on.' },
)
export const ScrolledUpWrappedDark: Story = { ...ScrolledUpWrapped, globals: { theme: 'dark' } }
