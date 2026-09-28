import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { MODEL_LIST, model, useModelPrefs } from '../../fixtures/models'
import { Brand } from '../../foundations/brands/brands'
import { ContextRing } from '../ContextRing/ContextRing'
import { Listening } from '../Listening/Listening'
import { Running } from '../Running/Running'
import { ModelPick } from '../ModelPick/ModelPick'
import { Composer, type ComposerProps } from './Composer'
import { States, statesOn } from '../../storybook/States'

const clock = (n: number) => `0:${String(n).padStart(2, '0')}`

/** The lower row as a consumer fills it: the model picker and the context meter. */
function Picker() {
  const [id, setId] = useState('claude-opus-5')
  const [effort, setEffort] = useState<string | null>(null)
  const prefs = useModelPrefs()
  const current = model(id)
  const def = prefs.defaultEffort(current)
  return (
    <ModelPick
      model={current}
      pinned={prefs.pinned}
      effort={effort ?? def}
      defaultEffort={def}
      owner="Lead"
      count={MODEL_LIST.length}
      onChange={(next) => {
        setId(next)
        setEffort(null)
      }}
      onEffort={setEffort}
      onMakeDefault={(level) => prefs.setDefaultEffort(id, level)}
    />
  )
}

/* What a voice looks like to the bars: a slow swell with some grain, the same on every run. */
const voice = (t: number) => Array.from({ length: 12 }, (_, i) => Math.abs(Math.sin((t + i) * 0.7) * Math.cos((t - i) * 0.31)))
const SAID = 'Also check the webhook retry path while you are in there.'.split(' ')

function Example(props: Partial<ComposerProps> & { initial?: string; recording?: boolean; streaming?: boolean; waiting?: string[] }) {
  const { initial = '', recording = false, streaming = false, waiting = [], onSendNow = () => {}, ...rest } = props
  const [value, setValue] = useState(initial)
  const [queue, setQueue] = useState(waiting.map((text, i) => ({ id: `q${i}`, text })))
  const [seconds, setSeconds] = useState<number | null>(recording ? 4 : null)
  const [tick, setTick] = useState(0)
  const running = seconds !== null
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setSeconds((n) => (n ?? 0) + 1), 1000)
    const w = window.setInterval(() => setTick((n) => n + 1), 140)
    return () => {
      window.clearInterval(t)
      window.clearInterval(w)
    }
  }, [running])
  /* a streaming transcriber: a word every few ticks, until the sentence is out */
  const heard = streaming ? SAID.slice(0, Math.min(SAID.length, 3 + Math.floor(tick / 4))).join(' ') : undefined
  return (
    <div style={{ maxWidth: 700, paddingTop: 60 }}>
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={(text) => {
          if (rest.busy) setQueue([...queue, { id: `q${queue.length}-${text.length}`, text }])
          setValue('')
        }}
        placeholder="Tell the lead"
        hint="/"
        picker={<Picker />}
        meter={<ContextRing used={122} total={1000} model={model('claude-opus-5')} />}
        dictation={{
          elapsed: seconds === null ? null : clock(seconds),
          levels: voice(tick),
          interim: heard,
          onStart: () => setSeconds(0),
          onStop: () => {
            setSeconds(null)
            setValue((v) => `${v ? `${v.trimEnd()} ` : ''}${SAID.join(' ')}`)
          },
        }}
        queued={queue}
        onEditQueued={(id) => {
          const q = queue.find((x) => x.id === id)
          if (q) setValue(q.text)
          setQueue(queue.filter((x) => x.id !== id))
        }}
        onUnqueue={(id) => setQueue(queue.filter((x) => x.id !== id))}
        {...rest}
        onSendNow={(text) => {
          onSendNow(text)
          setValue('')
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Composer/Composer',
  component: Composer,
  args: { value: '', onChange: fn(), onSubmit: fn(), placeholder: 'Tell the lead' },
} satisfies Meta<typeof Composer>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = { render: () => <Example /> }
export const Drafting: Story = { render: () => <Example initial="Keep the limiter where it is, and add the test first." /> }
export const MultiLine: Story = {
  render: () => <Example initial={'Two things:\n1. keep the limiter where it is\n2. add the test first'} />,
}
/** The lead is working: an empty composer offers to interrupt it. The task keeps going; the lead waits for you. */
export const Busy: Story = { render: () => <Example busy onStopAgent={() => {}} /> }
/** The lead is working and you have written something: Enter queues it, and Send now interrupts the lead with it instead. */
export const BusyWithDraft: Story = { render: () => <Example busy initial="Also check the webhook retry path." /> }
/** Sending now: ⌘Enter or the button. The lead stops at a safe point and carries on with both. */
export const SendingNow: Story = {
  args: { onSendNow: fn() },
  render: (args) => <Example busy onSendNow={args.onSendNow} initial="Stop, the limiter belongs in charges." />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByRole('textbox', { name: 'Tell the lead' })
    await userEvent.click(field)
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await expect(args.onSendNow).toHaveBeenCalledWith('Stop, the limiter belongs in charges.')
    await expect(field).toHaveValue('')
    await expect(c.queryByRole('button', { name: /Send now/ })).toBeNull()
    await userEvent.type(field, 'And keep the test.')
    await userEvent.click(c.getByRole('button', { name: /Send now/ }))
    await expect(args.onSendNow).toHaveBeenLastCalledWith('And keep the test.')
  },
}
/** Your voice drawn as bars while you talk; stopping puts what was heard in the field. */
export const Dictating: Story = { render: () => <Example recording /> }
/** A transcriber that streams: the words arrive faint in the field as you say them. */
export const DictatingWordByWord: Story = { render: () => <Example recording streaming initial="Keep the limiter where it is." /> }
/** Sent while the lead worked: it waits until the lead is done with what it is doing, and can be taken back or out. */
export const Queued: Story = {
  render: () => <Example busy onStopAgent={() => {}} waiting={['Also check the webhook retry path.']} />,
}
/** Queueing another, taking one out, and editing the one left. */
export const QueueingAndEditing: Story = {
  render: () => <Example busy onStopAgent={() => {}} waiting={['Also check the webhook retry path.']} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Queued; the lead reads it next')).toBeInTheDocument()
    await userEvent.type(c.getByRole('textbox', { name: 'Tell the lead' }), 'And keep the limiter where it is.{Enter}')
    await expect(c.getByText('2 queued; the lead reads them in order')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Take “Also check the webhook retry path.” out of the queue' }))
    await userEvent.click(c.getByRole('button', { name: 'Edit' }))
    await expect(c.getByRole('textbox', { name: 'Tell the lead' })).toHaveValue('And keep the limiter where it is.')
  },
}
export const SeveralQueued: Story = {
  render: () => (
    <Example
      busy
      onStopAgent={() => {}}
      waiting={[
        'Also check the webhook retry path.',
        'Use the fixture log, not staging.',
        'And say what the headers look like on a 429 once it passes.',
      ]}
    />
  ),
}
export const Listening_: Story = {
  name: 'Listening',
  render: () => (
    <Example
      busy
      above={<Listening sources={[{ id: 'pr', mark: Brand.GitHub, label: 'PR 1206', what: 'review comments and checks' }]} />}
    />
  ),
}
/** Listening, and a dev server the agent started and left running. */
export const ListeningAndRunning: Story = {
  render: () => (
    <Example
      above={
        <>
          <Listening sources={[{ id: 'pr', mark: Brand.GitHub, label: 'PR 1206', what: 'review comments and checks' }]} />
          <Running processes={[{ id: 'dev', command: 'bun dev', url: 'localhost:5173', since: '12m' }]} />
        </>
      }
    />
  ),
}
/** Nothing in the lower row but send: no picker, no meter, no dictation. */
export const Minimal: Story = { render: () => <Example picker={undefined} meter={undefined} dictation={undefined} hint={undefined} /> }

export const SendsOnEnter: Story = {
  render: function Render(args) {
    const [value, setValue] = useState('')
    return <Composer {...args} value={value} onChange={setValue} />
  },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByRole('textbox', { name: 'Tell the lead' })
    await userEvent.type(field, 'First line{Shift>}{Enter}{/Shift}second line')
    await expect(c.getByText('Shift+Enter for a new line')).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    await expect(args.onSubmit).toHaveBeenCalledWith('First line\nsecond line')
  },
}

/* The field takes the forced focus; the send button the forced hover and press. */
export const AllStates: Story = {
  parameters: statesOn({ hover: 'button[type="submit"]', focus: 'textarea', pressed: 'button[type="submit"]' }),
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'empty', node: <Example /> },
        { state: 'focus', node: <Example /> },
        { state: 'drafting', node: <Example initial="Keep the limiter where it is." /> },
        { state: 'send, hover', force: 'hover', node: <Example initial="Keep the limiter where it is." /> },
        { state: 'send, pressed', force: 'pressed', node: <Example initial="Keep the limiter where it is." /> },
        { state: 'several lines', node: <Example initial={'Two things:\n1. keep the limiter\n2. add the test first'} /> },
        { state: 'busy', node: <Example busy onStopAgent={() => {}} /> },
        { state: 'busy, queue or send now', node: <Example busy initial="Also check the webhook retry path." /> },
        { state: 'queued', node: <Example busy onStopAgent={() => {}} waiting={['Also check the webhook retry path.']} /> },
        {
          state: 'several queued',
          node: (
            <Example busy onStopAgent={() => {}} waiting={['Also check the webhook retry path.', 'Use the fixture log, not staging.']} />
          ),
        },
        { state: 'dictating', node: <Example recording /> },
        { state: 'dictating, word by word', node: <Example recording streaming initial="Keep the limiter where it is." /> },
        { state: 'minimal', node: <Example picker={undefined} meter={undefined} dictation={undefined} hint={undefined} /> },
      ]}
    />
  ),
}
