import { AsideTabs, CanvasLine, CanvasPanel, HalftoneMark, ThreadShellProvider } from '@althar/ui'
import { useRef } from 'react'

import { Tabs } from './app'
import app from './app.module.css'
import { useMarks } from './loop'
import { type Aim, button, Pointer } from './Pointer'
import p from './signin.module.css'
import { cx } from '../../../lib/cx'
import { Shot } from './Shot'
import { Typed, typed, Typing, typing, useGlide } from './talk'
import s from './views.module.css'

/** On a phone, how wide the window lays itself out: the canvas alone, its page as it reads that narrow (views.module.css, signin.module.css); on a tablet, the conversation narrower beside it. */
const PHONE_W = 460
const TABLET_W = 1000

/*
 * A canvas at work, as the app shows one: the coordinator's conversation on
 * the left, under the bar that says who it is with (the coordinator, then
 * its asides, as the app's project view heads it), and the canvas the lead
 * builds beside it, empty to begin with.
 *
 * You ask for Tally's sign-in page, and it is built as you watch, a piece at
 * a time, from the empty page: the name, the welcome, the two fields, the
 * button, the other ways in, the way to sign up. Then you ask for it split,
 * the brand on one side, and the brand's side opens beside the form. Each
 * ask is typed in the composer (the pointer still on it as you type) and
 * sent, rising into the conversation as a message does on a phone; each
 * answer streams in, and each version's line lands as it is published, the
 * canvas showing it at once. Whatever the conversation gains, it glides up
 * to make room, never jumps. Last, the pointer goes into the page and
 * signs in, and that is the end: it fades, and starts over (loop.ts).
 *
 * The page is drawn on this page itself, not in a frame, so each piece comes
 * in by a transition rather than a reload. It is drawn as such a page is now:
 * flat, with no borders, shadows or gradients; fields filled rather than
 * outlined, the one button solid, and type and room doing the rest. The
 * view is drawn again only at the story's moments; the typing between them
 * writes its own text, every frame.
 */

const none = () => {}

const LABEL =
  'A canvas open beside the conversation: Tally’s sign-in page built from an empty page, a piece at a time, then split with the brand on its left; then the pointer signs in'

const NAME = 'sign-in'
const TITLE = 'Sign-in page'
const OPENED = 'cnv_signin'

/** What the lead said of each version. */
const VERSIONS = ['Email and password, then Google and GitHub', 'Split: the brand on the left, the form on the right']

/** What you ask, and what the lead answers. */
const SAID = [
  'Build Tally’s sign-in page: email and password, and Google too.',
  'Now split it: our brand on the left, the form on the right.',
]
const REPLIES = ['Starting from a blank page.', 'Done: split, with the brand on the left.']

/** How fast you type, and the lead answers, in characters a second. */
const ASK_RATE = 70
const REPLY_RATE = 75
/*
 * The pointer's ways, in ms: a moment's pause once a thing is done, the glide
 * to the next (the pointer takes 560 ms), and how long it presses. The pointer
 * keeps still while you type, as a hand does on the keys: only once the ask
 * is all written does it go to Send.
 */
const PAUSE = 150
const GLIDE = 600
const PRESSING = 150

/** When each thing happens, in ms into the story, each from the last: an ask typed, then sent, answered and built; and last, signing in. */
const SEND1_GO = typing(SAID[0]!, ASK_RATE) + PAUSE
const SEND1 = SEND1_GO + GLIDE
const SENT1 = SEND1 + PRESSING
/** The page, built a piece at a time from empty: the name, the welcome, under it a line, the email, the password, the button, the other ways in, the way to sign up. */
const BUILD = Array.from({ length: 8 }, (_, i) => SENT1 + 350 + i * 230)
const LINE1 = BUILD.at(-1)! + 300
const CLICK2_GO = LINE1 + PAUSE
const CLICK2 = CLICK2_GO + GLIDE
const ASK2 = CLICK2 + PRESSING
const SEND2_GO = ASK2 + typing(SAID[1]!, ASK_RATE) + PAUSE
const SEND2 = SEND2_GO + GLIDE
const SENT2 = SEND2 + PRESSING
/** The split: the brand's side opens, then what is on it comes in. */
const SPLIT = [SENT2 + 450, SENT2 + 900, SENT2 + 1150]
const LINE2 = SPLIT.at(-1)! + 350
const SIGN_IN_GO = LINE2 + PAUSE
const SIGN_IN = SIGN_IN_GO + GLIDE
/** How long the story is: it ends as you sign in, and starts over from there. */
export const CANVAS_STORY = SIGN_IN + PRESSING + 120
/** How long it holds once you have signed in: hardly at all. */
const HOLD = 150
/** Still: the split page, built. */
const STILL = LINE2

const ASK_FROM = [0, ASK2]
const SENT = [SENT1, SENT2]
const REPLY_FROM = [SENT1 + 200, SENT2 + 200]
const LINES = [LINE1, LINE2]

/** The asides beside the coordinator, on the bar over its conversation. */
const ASIDES = [
  { id: 'a1', title: 'Refund webhooks retry too fast', ago: '2h' },
  { id: 'a2', title: 'Pricing page copy', ago: '1d' },
]

/** What the pointer does, in turn: when it sets out, what for, and when it presses it (for `PRESSING` ms). In the composer as you type, to Send once it is written, back into the composer for the next, and last into the page, to sign in. */
const POINTER: ReadonlyArray<{ at: number; aim: Aim; press?: number }> = [
  { at: 0, aim: 'textarea' },
  { at: SEND1_GO, aim: button('Send'), press: SEND1 },
  { at: CLICK2_GO, aim: 'textarea', press: CLICK2 },
  { at: SEND2_GO, aim: button('Send'), press: SEND2 },
  { at: SIGN_IN_GO, aim: '[data-act="sign-in"]', press: SIGN_IN },
]

/** The moments the view changes at. */
const MARKS = [
  ...SENT,
  ...REPLY_FROM,
  ...LINES,
  ...ASK_FROM,
  ...BUILD,
  ...SPLIT,
  ...POINTER.flatMap((one) => (one.press === undefined ? [one.at] : [one.at, one.press, one.press + PRESSING])),
]

/** What is in the composer `ms` into the story: the ask being typed, until it is sent. */
const composing = (ms: number) => {
  const i = ASK_FROM.findIndex((from, n) => ms >= from && ms < SENT[n]!)
  return i < 0 ? '' : typed(SAID[i]!, ms, ASK_FROM[i]!, ASK_RATE)
}

/** Tally's mark: a rounded square of its teal, a tally of three strokes across it. */
function Logo({ size }: { size: number }) {
  return (
    <svg className={p.logo} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="7" />
      <path d="M8 7v10M12 7v10M16 7v10" />
    </svg>
  )
}

/** Google's and GitHub's marks, as the buttons for them carry them. */
function Way({ name }: { name: 'Google' | 'GitHub' }) {
  return (
    <span className={p.way}>
      {name === 'Google' ? (
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
          <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
          <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#141417"
            d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 0 1 5.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z"
          />
        </svg>
      )}
      {name}
    </span>
  )
}

/** Tally's sign-in page at `ms`: empty to begin with, built a piece at a time; then split, its brand's side opening beside the form; and pressed, signing in. */
function Page({ ms, signing }: { ms: number; signing: boolean }) {
  const built = BUILD.filter((at) => ms >= at).length
  const split = SPLIT.filter((at) => ms >= at).length
  const on = (n: number) => (built > n ? '' : undefined)
  return (
    <div className={p.page} data-split={split > 0 || undefined}>
      <aside className={p.brand} aria-hidden={split === 0 || undefined}>
        <div className={p.brandName} data-on={split > 1 || undefined}>
          <Logo size={22} />
          <b>Tally</b>
        </div>
        <div className={p.claim} data-on={split > 2 || undefined}>
          <p className={p.big}>Every payment, accounted for.</p>
          <p className={p.small}>Tally reconciles Stripe, your banks and your books, as it happens.</p>
        </div>
      </aside>
      <div className={p.form}>
        <div className={p.inner}>
          <div className={`${p.piece} ${p.name}`} data-on={on(0)} data-hide={split > 1 || undefined}>
            <Logo size={22} />
            <b>Tally</b>
          </div>
          <h1 className={`${p.piece} ${p.title}`} data-on={on(1)}>
            Welcome back
          </h1>
          <p className={`${p.piece} ${p.lead}`} data-on={on(2)}>
            Sign in to your Tally workspace.
          </p>
          <div className={`${p.piece} ${p.field}`} data-on={on(3)}>
            <span className={p.label}>Email</span>
            <span className={p.input}>you@company.com</span>
          </div>
          <div className={`${p.piece} ${p.field}`} data-on={on(4)}>
            <span className={p.label}>
              Password
              <span className={p.forgot}>Forgot?</span>
            </span>
            <span className={`${p.input} ${p.dots}`}>••••••••••••</span>
          </div>
          <span className={`${p.piece} ${p.submit}`} data-on={on(5)} data-pressed={signing || undefined} data-act="sign-in">
            Sign in
          </span>
          <div className={`${p.piece} ${p.ways}`} data-on={on(6)}>
            <span className={p.or}>Or continue with</span>
            <div className={p.wayRow}>
              <Way name="Google" />
              <Way name="GitHub" />
            </div>
          </div>
          <p className={`${p.piece} ${p.foot}`} data-on={on(7)}>
            New to Tally? <span className={p.link}>Create an account</span>
          </p>
        </div>
      </div>
    </div>
  )
}

/** The page as the story leaves it, the design it comes to: built, split, its brand on the left (the flow's canvas drawing shows it). */
export function SignInPage() {
  return <Page ms={Infinity} signing={false} />
}

/** `active`: in front, so playing; behind, it holds where it is. */
export function CanvasAtWork({ active = true }: { active?: boolean } = {}) {
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [ms, read] = useMarks(box, CANVAS_STORY, STILL, MARKS, active, HOLD)
  useGlide(list)
  const lines = LINES.filter((at) => ms >= at).length
  const sent = SENT.map((at) => ms >= at)
  const replied = REPLY_FROM.map((from) => ms >= from)
  // Each version shows as soon as it is published.
  const shown = Math.max(1, lines)
  const pointer = POINTER.filter((one) => ms >= one.at).at(-1) ?? POINTER[0]!
  const pressing = pointer.press !== undefined && ms >= pointer.press && ms < pointer.press + PRESSING

  return (
    <div ref={box} className={s.wrap}>
      <Shot
        w={1440}
        h={780}
        phone={{ x: 560, y: 0, w: 880, h: 780 }}
        phoneW={PHONE_W}
        tabletW={TABLET_W}
        fill={{ phone: { x: 0, y: 0, w: PHONE_W }, tablet: { x: 0, y: 0, w: TABLET_W } }}
        label={LABEL}
        frame={cx(s.frame, s.canvasFit)}
      >
        <div className={app.window}>
          <Tabs current="tally" />
          {/* What fades as its story starts over (loop.ts): the conversation and the canvas, not the window's bar. */}
          <div className={s.beside} data-fade="">
            <ThreadShellProvider value={{ openCanvas: none, openedCanvas: OPENED }}>
              <div className={s.talk}>
                <AsideTabs
                  className={s.asides}
                  mark={<HalftoneMark size={15} rise={false} />}
                  asides={ASIDES}
                  current={null}
                  onPick={none}
                  onNew={none}
                />
                <div className={s.thread}>
                  <div ref={list} className={s.list}>
                    {VERSIONS.map((note, i) =>
                      sent[i] ? (
                        <div key={note} className={s.turn}>
                          <p className={`${s.ask} ${s.sent}`}>{SAID[i]}</p>
                          {replied[i] && (
                            <p className={`${s.said} ${s.reply}`}>
                              <Typed text={REPLIES[i]!} from={REPLY_FROM[i]!} rate={REPLY_RATE} read={read} active={active} />
                            </p>
                          )}
                          {lines > i && (
                            <div className={s.arrive}>
                              <CanvasLine
                                canvas={{ canvasId: OPENED, name: NAME, title: TITLE, kind: 'html', version: i + 1 }}
                                action="published"
                                note={note}
                              />
                            </div>
                          )}
                        </div>
                      ) : null,
                    )}
                  </div>
                </div>
                <div className={s.composer}>
                  <Typing composing={composing} read={read} active={active} placeholder="Tell the lead" />
                </div>
              </div>
            </ThreadShellProvider>
            <CanvasPanel
              name={NAME}
              title={TITLE}
              kind="html"
              version={shown}
              latest={shown}
              newer={null}
              by="The lead of Sign-in page · just now"
              note={VERSIONS[shown - 1]!}
              onVersion={none}
              onComment={none}
              onReload={none}
              onClose={none}
              fill
            >
              <Page ms={ms} signing={pressing && pointer.aim === POINTER.at(-1)!.aim} />
            </CanvasPanel>
            <Pointer aim={pointer.aim} press={pressing} rest={[0.62, 0.9]} ms={ms} />
          </div>
        </div>
      </Shot>
    </div>
  )
}
