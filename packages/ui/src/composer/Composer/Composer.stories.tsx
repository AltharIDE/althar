import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef, useState } from 'react'
import { expect, fireEvent, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { MODEL_LIST, model, useModelPrefs } from '../../fixtures/models'
import { SHOT_AFTER, SHOT_BEFORE } from '../../fixtures/shots'
import { Brand } from '../../foundations/brands/brands'
import { DictationSetup } from '../../foundations/vocabulary'
import { ContextRing } from '../ContextRing/ContextRing'
import { DictationTray, type DictationState } from '../DictationTray/DictationTray'
import { Listening } from '../Listening/Listening'
import { Running } from '../Running/Running'
import { ModelPick } from '../ModelPick/ModelPick'
import { Composer, type ComposerImage, type ComposerProps, type DictationInput } from './Composer'
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
/* The microphones a Mac with a headset and a USB microphone names. */
const INPUTS: readonly DictationInput[] = [
  { id: 'built-in', label: 'MacBook Pro Microphone' },
  { id: 'airpods', label: 'AirPods Pro' },
  { id: 'usb', label: 'Shure MV7' },
]

/* Images as the host has read them: the two screenshots, as small copies. */
const SHOTS: ComposerImage[] = [
  { id: 'i1', name: 'refunds-before.png', src: SHOT_BEFORE.src },
  { id: 'i2', name: 'refunds-after.png', src: SHOT_AFTER.src },
]

/* What the host says of a file that isn't a picture it can send. */
const refusedNote = (name: string) => `${name} isn’t a PNG, JPEG, GIF or WebP image, so it can’t be sent.`

function Example(
  props: Partial<ComposerProps> & {
    initial?: string
    recording?: boolean
    streaming?: boolean
    /** The words the transcriber hears and writes on stopping (default: one sentence). */
    transcript?: readonly string[]
    /** Words heard per step of the streaming transcriber (default: one). */
    pace?: number
    waiting?: (string | { text: string; attached: string })[]
    at?: number
    inputs?: readonly DictationInput[]
    /** Images already added. */
    pictures?: ComposerImage[]
    /** Takes images: what is dropped, pasted or picked is read as the host would, and anything that isn't an image refused. */
    takesImages?: boolean
  },
) {
  const {
    initial = '',
    recording = false,
    streaming = false,
    transcript = SAID,
    pace = 1,
    waiting = [],
    at,
    inputs = INPUTS,
    pictures = [],
    takesImages = false,
    onSendNow = () => {},
    ...rest
  } = props
  const [value, setValue] = useState(initial)
  const [input, setInput] = useState<string | null>(null)
  const [images, setImages] = useState(pictures)
  const [note, setNote] = useState<string | undefined>(undefined)
  const [queue, setQueue] = useState(waiting.map((said, i) => ({ id: `q${i}`, ...(typeof said === 'string' ? { text: said } : said) })))
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
  const heard = streaming ? transcript.slice(0, Math.min(transcript.length, 3 + pace * Math.floor(tick / 4))).join(' ') : undefined
  return (
    <div style={{ maxWidth: 700, paddingTop: 60 }}>
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={(text) => {
          if (rest.busy)
            setQueue([
              ...queue,
              { id: `q${queue.length}-${text.length}`, text, ...(images.length > 0 ? { attached: `${images.length} images` } : {}) },
            ])
          setValue('')
          setImages([])
        }}
        images={images}
        {...(takesImages
          ? {
              onAddImages: (files: readonly File[]) => {
                const refused = files.find((file) => !file.type.startsWith('image/'))
                setNote(refused === undefined ? undefined : refusedNote(refused.name))
                const added = files.filter((file) => file.type.startsWith('image/'))
                setImages((now) => [
                  ...now,
                  ...added.map((file, i) => ({ id: `added-${now.length + i}`, name: file.name, src: SHOT_BEFORE.src })),
                ])
              },
              onRemoveImage: (id: string) => setImages((now) => now.filter((image) => image.id !== id)),
              imageNote: note,
            }
          : {})}
        placeholder="Tell the lead"
        hint="/"
        picker={<Picker />}
        meter={<ContextRing used={122} total={1000} model={model('claude-opus-5')} />}
        dictation={{
          elapsed: seconds === null ? null : clock(seconds),
          levels: voice(tick),
          interim: heard,
          ...(at === undefined ? {} : { at }),
          kbd: '⌘⇧D',
          inputs,
          input,
          onChooseInput: setInput,
          onStart: () => setSeconds(0),
          onStop: () => {
            setSeconds(null)
            setValue((v) => `${v ? `${v.trimEnd()} ` : ''}${transcript.join(' ')}`)
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

/*
 * A host standing in for the app: no speech model at first, so the
 * microphone opens the tray; Download brings one down (here in about a
 * second), it listens, and what was said lands at the cursor.
 */
function FirstTime({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [got, setGot] = useState<number | null>(null)
  const [seconds, setSeconds] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const at = useRef(0)
  const ready = got === 480
  const downloading = got !== null && got < 480
  useEffect(() => {
    if (!downloading) return
    const t = window.setInterval(() => {
      at.current = Math.min(480, at.current + 60)
      setGot(at.current)
      /* landed while you waited at the tray: it listens */
      if (at.current === 480) {
        setOpen(false)
        setSeconds(0)
      }
    }, 100)
    return () => window.clearInterval(t)
  }, [downloading])
  const tray: DictationState | null = !open
    ? null
    : downloading
      ? { kind: DictationSetup.Downloading, got: `${got} MB`, size: '480 MB', progress: (got ?? 0) / 480 }
      : { kind: DictationSetup.Offer, size: '480 MB' }
  return (
    <div style={{ maxWidth: 700, paddingTop: 60 }}>
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={onSubmit}
        placeholder="Tell the lead"
        tray={
          tray && (
            <DictationTray
              state={tray}
              onDownload={() => {
                at.current = 0
                setGot(0)
              }}
              onCancel={() => {
                setGot(null)
                setOpen(false)
              }}
              onDismiss={() => setOpen(false)}
            />
          )
        }
        dictation={{
          elapsed: seconds === null ? null : clock(seconds),
          busy,
          expanded: open,
          progress: downloading && !open ? (got ?? 0) / 480 : undefined,
          onStart: () => (ready ? setSeconds(0) : setOpen((o) => !o)),
          onStop: () => {
            setSeconds(null)
            setBusy(true)
            window.setTimeout(() => {
              setBusy(false)
              setValue((v) => `${v ? `${v.trimEnd()} ` : ''}${SAID.join(' ')}`)
            }, 300)
          },
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
/** Enter while dictating stops without sending, and the field is the size the same text typed would be: one row for a short transcript. */
export const EnterEndsDictationAtItsSize: Story = {
  render: () => {
    const said = SAID.join(' ')
    const longWords = Array.from({ length: 12 }, () => SAID).flat()
    const long = longWords.join(' ')
    return (
      <>
        <div data-testid="dictated-short">
          <Example recording streaming />
        </div>
        <div data-testid="typed-short">
          <Example initial={said} />
        </div>
        <div data-testid="dictated-long">
          <Example recording streaming transcript={longWords} pace={10} />
        </div>
        <div data-testid="typed-long">
          <Example initial={long} />
        </div>
      </>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const box = (id: string) => within(c.getByTestId(id)).getByRole('textbox') as HTMLTextAreaElement
    const height = (id: string) => box(id).getBoundingClientRect().height
    for (const kind of ['short', 'long']) {
      const field = box(`dictated-${kind}`)
      /* the long transcript is still arriving: stop with its faint words several rows tall over the field */
      if (kind === 'long')
        await waitFor(() => expect((field.previousElementSibling as HTMLElement).getBoundingClientRect().height).toBeGreaterThan(80), {
          timeout: 10000,
        })
      await userEvent.type(field, '{Enter}')
      await expect(within(c.getByTestId(`dictated-${kind}`)).queryByRole('button', { name: /^Stop dictating/ })).not.toBeInTheDocument()
      /* stopped, not sent: the words are in the field, and it is as tall as the same text typed */
      await expect(field.value).toBe(box(`typed-${kind}`).value)
      await expect(height(`dictated-${kind}`)).toBeCloseTo(height(`typed-${kind}`), 0)
    }
    /* a short transcript stays one row; a long one is capped like typed text */
    await expect(height('dictated-short')).toBeLessThan(height('dictated-long'))
  },
}
/** A dictation grown past the composer's max height: it stays at 200px with the newest words in view, and the earlier text scrolls under the wheel. */
export const LongDictation: Story = {
  render: () => (
    <Example
      recording
      streaming
      initial="Keep the limiter where it is."
      transcript={Array.from({ length: 30 }, () => SAID).flat()}
      pace={12}
    />
  ),
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Tell the lead' })
    const overlay = field.previousElementSibling as HTMLElement
    await waitFor(() => expect(overlay.scrollHeight).toBeGreaterThan(overlay.clientHeight + 40), { timeout: 10000 })
    await expect(overlay.clientHeight).toBeLessThanOrEqual(200)
    await waitFor(() => expect(overlay.scrollTop).toBeGreaterThan(0))
    /* earlier text can be read by wheel while it goes on */
    fireEvent.wheel(field, { deltaY: -60 })
    await waitFor(() => expect(overlay.scrollTop).toBeLessThan(overlay.scrollHeight - overlay.clientHeight - 20))
  },
}
/** Which microphone it hears, from the menu beside it: the system's default first, then each the system names. */
export const ChoosingTheMicrophone: Story = {
  render: () => <Example />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Choose the microphone' }))
    const menu = await screen.findByRole('menu', { name: 'Microphone' })
    const items = within(menu).getAllByRole('menuitemradio')
    await expect(items.map((item) => item.textContent)).toEqual(['System default', ...INPUTS.map((i) => i.label)])
    await expect(within(menu).getByRole('menuitemradio', { name: 'System default' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'Shure MV7' }))
    await userEvent.click(c.getByRole('button', { name: 'Choose the microphone' }))
    const again = await screen.findByRole('menu', { name: 'Microphone' })
    await expect(within(again).getByRole('menuitemradio', { name: 'Shure MV7' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.keyboard('{Escape}')
  },
}
/** Before the system names its microphones, only its default can be chosen, and a note says when the others come. */
export const ChoosingTheMicrophoneFirstTime: Story = {
  render: () => <Example inputs={[]} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Choose the microphone' }))
    const menu = await screen.findByRole('menu', { name: 'Microphone' })
    await expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(1)
    await expect(within(menu).getByText(/Other microphones show here/)).toBeInTheDocument()
  },
}
/** Another microphone, chosen while you talk: it goes on from that one, and what you said before stays. */
export const ChoosingTheMicrophoneWhileDictating: Story = {
  render: () => <Example recording />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Choose the microphone' }))
    const menu = await screen.findByRole('menu', { name: 'Microphone' })
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'AirPods Pro' }))
    await expect(c.getByRole('button', { name: /^Stop dictating/ })).toBeInTheDocument()
  },
}
/** The first press, with no speech model yet: a tray on the composer's top offers it. */
export const DictationOffer: Story = {
  render: () => (
    <Example
      tray={<DictationTray state={{ kind: DictationSetup.Offer, size: '480 MB' }} onDownload={() => {}} onDismiss={() => {}} />}
      dictation={{ elapsed: null, expanded: true, onStart: () => {}, onStop: () => {} }}
    />
  ),
}
/** The speech model coming down: the tray's edge is the bar, and the field stays yours to type in. */
export const DictationDownloading: Story = {
  render: () => (
    <Example
      initial="Before the PR, "
      tray={
        <DictationTray
          state={{ kind: DictationSetup.Downloading, got: '198 MB', size: '480 MB', left: 'about 20 s', progress: 198 / 480 }}
          onCancel={() => {}}
          onDismiss={() => {}}
        />
      }
      dictation={{ elapsed: null, expanded: true, onStart: () => {}, onStop: () => {} }}
    />
  ),
}
/** The tray hidden while it downloads: a ring round the microphone says how far it has come. */
export const DictationDownloadingHidden: Story = {
  render: () => <Example dictation={{ elapsed: null, progress: 0.41, onStart: () => {}, onStop: () => {} }} />,
}
/** Writing down what was said: the microphone turns. */
export const DictationWriting: Story = {
  render: () => <Example dictation={{ elapsed: null, busy: true, onStart: () => {}, onStop: () => {} }} />,
}
/** What floats on the edge sits above the tray, not over it. */
export const DictationTrayAndListening: Story = {
  render: () => (
    <Example
      busy
      above={<Listening sources={[{ id: 'pr', mark: Brand.GitHub, label: 'PR 1206', what: 'review comments and checks' }]} />}
      tray={<DictationTray state={{ kind: DictationSetup.Denied }} onOpenSettings={() => {}} onDismiss={() => {}} />}
      dictation={{ elapsed: null, expanded: true, onStart: () => {}, onStop: () => {} }}
    />
  ),
}
/** The whole first time, quickly: offer, download, listening, and the words at the cursor. Never sent. */
export const DictationFirstTime: Story = {
  args: { onSubmit: fn() },
  render: (args) => <FirstTime onSubmit={args.onSubmit} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Dictate' }))
    await expect(c.getByRole('button', { name: 'Download' })).toHaveFocus()
    await userEvent.click(c.getByRole('button', { name: 'Download' }))
    await expect(c.getByRole('progressbar', { name: 'Speech model download' })).toBeInTheDocument()
    await userEvent.click(await c.findByRole('button', { name: /^Stop dictating/ }, { timeout: 4000 }))
    await waitFor(() => expect(c.getByRole('textbox', { name: 'Tell the lead' })).toHaveValue(SAID.join(' ')), { timeout: 3000 })
    await expect(args.onSubmit).not.toHaveBeenCalled()
  },
}
/** Words arriving in the middle of what is written: faint where they will land, the text after them moved along. */
export const DictatingMidSentence: Story = {
  render: () => <Example recording streaming initial="Before the PR, run it again." at={14} />,
  play: async ({ canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Tell the lead' })
    // While words arrive, the field is the dictation's.
    await expect(field).toHaveAttribute('readonly')
  },
}
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

/** Images to send with what you write, drawn small above the field, each with a way off. */
export const WithImages: Story = {
  render: () => <Example takesImages pictures={SHOTS} initial="The refund button moved; put it back where it was." />,
}
/** Images alone are something to send: the button shows, and Enter sends them with nothing written. */
export const ImagesOnly: Story = {
  args: { onSubmit: fn() },
  render: (args) => <Example takesImages pictures={SHOTS.slice(0, 1)} onSubmit={args.onSubmit} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('textbox', { name: 'Tell the lead' }))
    await userEvent.keyboard('{Enter}')
    await expect(args.onSubmit).toHaveBeenCalledWith('')
  },
}
/** Dropped on it, pasted into it or picked with Add images: each goes to the host, which adds it, and takes it off again. */
export const AddingImages: Story = {
  render: () => <Example takesImages />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByRole('textbox', { name: 'Tell the lead' })
    const shot = new File(['png'], 'shot.png', { type: 'image/png' })
    // Held over it, it says what dropping does; carried away, it doesn't.
    await fireEvent.dragEnter(field, { dataTransfer: { types: ['Files'], files: [shot] } })
    await expect(c.getByText('Drop to add them to your message')).toBeInTheDocument()
    await fireEvent.dragLeave(field, { dataTransfer: { types: ['Files'], files: [shot] } })
    await expect(c.queryByText('Drop to add them to your message')).toBeNull()
    await fireEvent.dragEnter(field, { dataTransfer: { types: ['Files'], files: [shot] } })
    await fireEvent.drop(field, { dataTransfer: { types: ['Files'], files: [shot] } })
    await expect(c.getByRole('list', { name: '1 image to send' })).toBeInTheDocument()
    await expect(c.getByRole('img', { name: 'shot.png' })).toBeInTheDocument()
    // A picture on the clipboard is added, not pasted as words.
    await fireEvent.paste(field, { clipboardData: { files: [new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' })], types: ['Files'] } })
    await expect(c.getByRole('list', { name: '2 images to send' })).toBeInTheDocument()
    await expect(field).toHaveValue('')
    // Words on the clipboard paste as words.
    await fireEvent.paste(field, { clipboardData: { files: [], types: ['text/plain'] } })
    await expect(c.getByRole('list', { name: '2 images to send' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Remove shot.png' }))
    await expect(c.getByRole('list', { name: '1 image to send' })).toBeInTheDocument()
    // Picked with the button, from the file input it opens.
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')
    await expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/gif,image/webp')
    if (input !== null) await userEvent.upload(input, new File(['gif'], 'loop.gif', { type: 'image/gif' }))
    await expect(c.getByRole('list', { name: '2 images to send' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Add images' })).toBeInTheDocument()
  },
}
/** A file the host won't send: it says why in a line over the field, and the rest are added. */
export const ImageRefused: Story = {
  render: () => <Example takesImages />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const files = [new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' }), new File(['png'], 'shot.png', { type: 'image/png' })]
    await fireEvent.drop(c.getByRole('textbox', { name: 'Tell the lead' }), { dataTransfer: { types: ['Files'], files } })
    await expect(c.getByRole('status')).toHaveTextContent(refusedNote('notes.pdf'))
    await expect(c.getByRole('list', { name: '1 image to send' })).toBeInTheDocument()
  },
}
/** One still being read or made smaller turns until it is ready. */
export const ReadingImage: Story = {
  render: () => (
    <Example takesImages pictures={[SHOTS[0] ?? { id: 'i1', name: 'refunds-before.png' }, { id: 'i3', name: 'huge.png', reading: true }]} />
  ),
  play: async ({ canvasElement }) => {
    // Said as a status, in place of its picture.
    await expect(within(canvasElement).getByText('Reading huge.png').closest('[role="status"]')).toBeInTheDocument()
    await expect(within(canvasElement).queryByRole('img', { name: 'huge.png' })).toBeNull()
  },
}
/** The host says the agent doesn't take images: the line says so over the images waiting, before anything is sent. */
export const AgentTakesNoImages: Story = {
  render: () => (
    <Example
      takesImages
      pictures={SHOTS}
      imageNote="Codex doesn’t take images. Remove them to send this, or pick an agent that does."
      initial="Why does it look like this?"
    />
  ),
}
/** Without an image the placeholder stands in its place; without onAddImages there is no button, and nothing is taken. */
export const NoImageSource: Story = {
  render: () => <Example pictures={[{ id: 'i1', name: 'refunds-before.png' }]} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('img', { name: 'refunds-before.png' })).toBeInTheDocument()
    await expect(c.queryByRole('button', { name: 'Add images' })).toBeNull()
    await expect(c.queryByRole('button', { name: /^Remove/ })).toBeNull()
  },
}
/** Sent with images while the lead worked: the queue says what went with each. */
export const QueuedWithImages: Story = {
  render: () => (
    <Example
      busy
      onStopAgent={() => {}}
      waiting={[
        { text: 'Like this one.', attached: '2 images' },
        { text: '', attached: '1 image' },
      ]}
    />
  ),
}

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

/** Enter while dictating wraps up and writes down what was said, and does not send; with ⌘Enter the same. */
export const EnterStopsDictating: Story = {
  args: { onSubmit: fn(), onSendNow: fn(), busy: true, dictation: { elapsed: '0:04', onStart: () => {}, onStop: fn() } },
  render: (args) => <Composer {...args} value="Keep the limiter where it is." onChange={() => {}} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const field = c.getByRole('textbox', { name: 'Tell the lead' })
    await userEvent.click(field)
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await expect(args.dictation?.onStop).toHaveBeenCalledTimes(2)
    await expect(args.onSubmit).not.toHaveBeenCalled()
    await expect(args.onSendNow).not.toHaveBeenCalled()
  },
}
/** Enter while what was said is written down does nothing: a half-finished message cannot go. */
export const EnterWhileWritingDoesNothing: Story = {
  args: { onSubmit: fn(), onSendNow: fn(), dictation: { elapsed: null, busy: true, onStart: () => {}, onStop: fn() } },
  render: (args) => <Composer {...args} value="Keep the limiter where it is." onChange={() => {}} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('textbox', { name: 'Tell the lead' }))
    await userEvent.keyboard('{Enter}')
    await expect(args.dictation?.onStop).not.toHaveBeenCalled()
    await expect(args.onSubmit).not.toHaveBeenCalled()
  },
}
/** Once the text is in the field and dictation has ended, Enter sends as usual. */
export const EnterSendsAfterDictating: Story = {
  args: { onSubmit: fn() },
  render: (args) => (
    <Composer
      {...args}
      value="Keep the limiter where it is."
      onChange={() => {}}
      dictation={{ elapsed: null, onStart: () => {}, onStop: () => {} }}
    />
  ),
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('textbox', { name: 'Tell the lead' }))
    await userEvent.keyboard('{Enter}')
    await expect(args.onSubmit).toHaveBeenCalledWith('Keep the limiter where it is.')
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
        { state: 'images', node: <Example takesImages pictures={SHOTS} initial="Put the button back." /> },
        { state: 'images only', node: <Example takesImages pictures={SHOTS.slice(0, 1)} /> },
        {
          state: 'reading an image',
          node: <Example takesImages pictures={[{ id: 'i3', name: 'huge.png', reading: true }]} />,
        },
        {
          state: 'agent takes no images',
          node: (
            <Example
              takesImages
              pictures={SHOTS}
              imageNote="Codex doesn’t take images. Remove them to send this, or pick an agent that does."
            />
          ),
        },
        {
          state: 'queued, with images',
          node: <Example busy onStopAgent={() => {}} waiting={[{ text: 'Like this one.', attached: '2 images' }]} />,
        },
      ]}
    />
  ),
}
