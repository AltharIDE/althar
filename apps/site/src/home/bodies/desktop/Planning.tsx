import { AsideTabs, HalftoneMark, type LaunchPhase, type LaunchStep, type ModelInfo, TaskCard, type TaskStatus, Turn } from '@althar/ui'
import { Fragment, useRef, useState } from 'react'

import { Launch } from '../kit/app'
import { type Aim, button } from '../kit/Pointer'
import { Typed, typed, Typing, typing, useGlide } from '../kit/talk'
import v from '../kit/views.module.css'
import { GEMINI_PRO, OPUS, PLAN_432 } from '../kit/world'

/*
 * The coordinator's conversation beside Tally's board, the two side by side
 * as a project's home lays them out: how the task the board follows gets
 * there. You ask for the backfill, typed into the composer (the pointer still
 * on it as you type) and sent. The coordinator turns it into a plan as you
 * watch, the plan's card filling in as the draft is written: the brief, the
 * lead chosen (Opus, to write the code), then the reviewer (Gemini). Then the
 * plan whole, with its clock: it starts on its own when the bar under it runs
 * out, leaving it alone being a yes. The pointer starts it now instead.
 * Started, it waits for a free agent, as the card says where its clock was,
 * and it comes into the board's Up next; once it runs, the card is the
 * task's, keeping up with the board as it goes (AtWork.tsx).
 *
 * And you get on with something else altogether while it runs: back into
 * the composer, a question about another part of Tally, answered, and a
 * second, the backfill's card going on above them as the board carries it
 * on, until it comes to you on the board.
 *
 * On the views' clock, in ms. Drawn again only at its moments; the typing
 * between them writes its own text, every frame.
 */

const none = () => {}

const ASK = 'Backfill idempotency keys on the refunds made before PR 1184.'
const TASK = '427'
const TITLE = 'Backfill idempotency keys on refunds created before PR 1184'
/** Where it stands once started, its first step waiting for an agent: as the app says it, where its clock was. */
const QUEUED = 'Waiting · 4 agents busy'

/** Then something else altogether, while the backfill runs: what you ask the coordinator, and what it answers. */
const ASIDE = [
  'Unrelated: the payouts CSV export times out for our biggest accounts. Why?',
  'Would fixing it change anything for people using the API?',
]
const ANSWERS = [
  'It builds the whole file in memory before it sends a byte, so big accounts hit the 30s limit. Streaming it in pages would fix that.',
  'No. The endpoint and the file stay the same; only how it is sent changes.',
]

/** How fast you type, and the coordinator answers, in characters a second. */
const ASK_RATE = 70
const REPLY_RATE = 90
/** The pointer's ways: a moment's pause once a thing is done, the glide to the next (the pointer takes 560 ms), and how long it presses. */
const PAUSE = 150
const GLIDE = 600
const PRESSING = 150

/** When each thing happens, in ms into the story: the ask typed and sent; the plan drafted, a part at a time; its clock running; and started. */
const TYPE_FROM = 250
const SEND_GO = TYPE_FROM + typing(ASK, ASK_RATE) + PAUSE
const SEND = SEND_GO + GLIDE
const SENT = SEND + PRESSING
/** The card comes as the coordinator begins: writing the brief, the title still to come. */
const DRAFT = SENT + 400
/** The brief written, its title with it; sizing it. */
const SIZING = DRAFT + 700
/** Choosing a lead, the makers' marks rolling through its seat; then it lands, and the reviewer is chosen. */
const LEAD = SIZING + 400
const LED = LEAD + 900
const REVIEWED = LED + 900
/** The plan, whole, and its clock running. */
const PLANNED = REVIEWED + 600
/** How long the plan gives you before it starts on its own, in s: the picture's own, shorter than the app's half a minute. */
const WAIT = 10
const START_GO = PLANNED + 2000
const START = START_GO + GLIDE
/** Started: from here the board's story plays (AtWork.tsx). */
export const STARTED = START + PRESSING
/** Back into the composer, the other question typed and sent, and answered; the second typed straight after, the pointer still on Send, and answered. */
const CLICK_GO = STARTED + 100
const CLICK = CLICK_GO + GLIDE
const ASIDE_FROM = CLICK + PRESSING
const SEND2_GO = ASIDE_FROM + typing(ASIDE[0]!, ASK_RATE) + PAUSE
const SEND2 = SEND2_GO + GLIDE
const SENT2 = SEND2 + PRESSING
const ANSWER2 = SENT2 + 300
const AGAIN_FROM = ANSWER2 + typing(ANSWERS[0]!, REPLY_RATE) + 350
const SEND3 = AGAIN_FROM + typing(ASIDE[1]!, ASK_RATE) + 250
const SENT3 = SEND3 + PRESSING
const ANSWER3 = SENT3 + 300

/** Each ask: what it says, when it is typed from, and when it is sent. */
const ASKS = [
  { said: ASK, from: TYPE_FROM, sent: SENT },
  { said: ASIDE[0]!, from: ASIDE_FROM, sent: SENT2 },
  { said: ASIDE[1]!, from: AGAIN_FROM, sent: SENT3 },
]
/** The answers to the other questions, and when each starts. */
const ANSWERED = [ANSWER2, ANSWER3]

/** The plan as the coordinator makes it: Opus leads and writes the code, Gemini reviews, and the project's rule adds its security review. */
const PLAN: readonly LaunchStep[] = PLAN_432.map((step) => (step.id === 'review' ? { ...step, agents: [GEMINI_PRO] } : step))

const SEND_BUTTON = button('Send')

/** What the pointer does in the conversation: in the composer as you type, to Send once it is written, to Start now while the plan counts down; back into the composer for the other question, and Send again, and again. */
const POINTER: ReadonlyArray<{ at: number; aim: Aim; press?: number }> = [
  { at: 0, aim: 'textarea' },
  { at: SEND_GO, aim: SEND_BUTTON, press: SEND },
  { at: START_GO, aim: button('Start now'), press: START },
  { at: CLICK_GO, aim: 'textarea', press: CLICK },
  { at: SEND2_GO, aim: SEND_BUTTON, press: SEND2 },
  { at: SEND3, aim: SEND_BUTTON, press: SEND3 },
]

/** Where the pointer is aimed `ms` into the story, in the conversation, and whether it presses. */
export function pointerAt(ms: number) {
  const one = POINTER.filter((step) => ms >= step.at).at(-1) ?? POINTER[0]!
  return { aim: one.aim, press: one.press !== undefined && ms >= one.press && ms < one.press + PRESSING }
}

/** The moments the conversation changes at. */
const MARKS = [
  SENT,
  DRAFT,
  SIZING,
  LEAD,
  LED,
  REVIEWED,
  PLANNED,
  STARTED,
  SENT2,
  SENT3,
  ...ANSWERED,
  ...POINTER.flatMap((one) => (one.press === undefined ? [one.at] : [one.at, one.press, one.press + PRESSING])),
].sort((a, b) => a - b)

/** The last of its moments passed `ms` into the story: what it is drawn at. */
export const momentOf = (ms: number) => {
  let at = 0
  for (const mark of MARKS) if (ms >= mark) at = mark
  return at
}

/** What is in the composer `ms` into the story: an ask being typed, until it is sent. */
const composing = (ms: number) => {
  const one = ASKS.find((ask) => ms < ask.sent)
  return one === undefined ? '' : typed(one.said, ms, one.from, ASK_RATE)
}

/** What drafting is at, as its card says it. */
const phaseAt = (ms: number): LaunchPhase =>
  ms < SIZING ? 'writing' : ms < LEAD ? 'sizing' : ms < LED ? 'lead' : ms < REVIEWED ? 'review' : 'end'

/** The steps drafted so far: each seat open until its model is chosen. */
const draftedAt = (ms: number): LaunchStep[] => [
  { id: 'impl', label: 'Implement', agents: ms >= LED ? [OPUS] : [] },
  { id: 'review', label: 'Review', agents: ms >= REVIEWED ? [GEMINI_PRO] : [] },
]

/** The task the plan became, once it runs: where it stands, the step it is on, and who leads it, as the board has it. */
export interface Running {
  status: TaskStatus
  steps: readonly string[]
  at: number
  lead: ModelInfo
}

/** How the coordinator signs each of its turns, as the app does: Althar's mark, its name, and the day. */
const SIGNED = { voice: 'Coordinator', mark: <HalftoneMark size={15} rise={false} />, at: 'Nov 16' } as const

/** The asides beside the coordinator, on the bar over its conversation. */
const ASIDES = [
  { id: 'a1', title: 'Refund webhooks retry too fast', ago: '2h' },
  { id: 'a2', title: 'Pricing page copy', ago: '1d' },
]

/**
 * The plan whole, its clock running: kept by the story, not the card, so the
 * card counts down from what is left of its wait as the story stands when it
 * is drawn; drawn anew as it comes back to the front (Planning keys it so),
 * wherever its own count had got to behind.
 */
function Plan({ read, started }: { read: () => number; started: boolean }) {
  const [startsAt] = useState(() => Date.now() + WAIT * 1000 - (read() - PLANNED))
  return (
    <Launch
      task={TASK}
      title={TITLE}
      from={false}
      preset="Change"
      steps={PLAN}
      wait={WAIT}
      startsAt={startsAt}
      narrow
      {...(started ? { queued: QUEUED } : {})}
    />
  )
}

/** The conversation `ms` into the story (at its last moment passed), the clock read for what moves between them; `running`, the task once it runs. */
export function Planning({ ms, read, active, running }: { ms: number; read: () => number; active: boolean; running: Running | null }) {
  const list = useRef<HTMLDivElement>(null)
  useGlide(list)
  const card = running ? (
    <TaskCard
      task={TASK}
      title={TITLE}
      status={running.status}
      steps={running.steps}
      at={running.at}
      started="just now"
      lead={running.lead}
      fresh
    />
  ) : ms >= PLANNED ? (
    <Plan key={active ? 'plan' : 'plan behind'} read={read} started={ms >= STARTED} />
  ) : (
    <Launch
      key="draft"
      task={TASK}
      title={ms >= SIZING ? TITLE : ''}
      from={false}
      steps={draftedAt(ms)}
      wait={WAIT}
      narrow
      drafting={{ phase: phaseAt(ms) }}
    />
  )
  return (
    <div className={v.talk}>
      <AsideTabs
        className={v.asides}
        mark={<HalftoneMark size={15} rise={false} />}
        asides={ASIDES}
        current={null}
        onPick={none}
        onNew={none}
      />
      <div className={v.thread}>
        <div ref={list} className={v.list}>
          {ms >= SENT && <p className={`${v.ask} ${v.sent}`}>{ASK}</p>}
          {ms >= DRAFT && (
            <Turn {...SIGNED} className={v.arrive}>
              {card}
            </Turn>
          )}
          {ASKS.slice(1).map((ask, i) =>
            ms >= ask.sent ? (
              <Fragment key={ask.said}>
                <p className={`${v.ask} ${v.sent}`}>{ask.said}</p>
                {ms >= ANSWERED[i]! && (
                  <Turn {...SIGNED} className={v.reply}>
                    <p className={v.said}>
                      <Typed text={ANSWERS[i]!} from={ANSWERED[i]!} rate={REPLY_RATE} read={read} active={active} />
                    </p>
                  </Turn>
                )}
              </Fragment>
            ) : null,
          )}
        </div>
      </div>
      <div className={v.composer}>
        <Typing composing={composing} read={read} active={active} placeholder="Tell Tally what you want done" />
      </div>
    </div>
  )
}
