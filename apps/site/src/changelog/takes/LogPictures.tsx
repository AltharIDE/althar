import { Brand, BrandMark, Icon, Logo, planPeekText, reportProblemText } from '@althar/ui'
import { sealSvg } from '@althar/ui/seal'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'

import { Agent, AGENTS } from '../../content/agents'
import { Fragment } from '../../home/bodies/desktop/Fragment'
import automations from '../../home/bodies/desktop/styled/d-automations.html?raw'
import { cx } from '../../lib/cx'
import { AgentMark } from '../../shared/AgentMark'
import { OsMark } from '../../shared/OsMark'
import type { Picture } from './LogData'
import p from './LogPictures.module.css'

/*
 * The highlights' pictures: each a feature drawn as an interface lit by one
 * light, as the homepage draws them, on the log's own warm dark. Drawn in
 * the app's own words and marks, in the kit's demo world (Tally, a payments
 * API). Each is laid out in em on a width of `w` em, scaled to the width it
 * is given, so it stays crisp; in a narrow place it lays itself out again on
 * `n` em, larger, so it still reads on a phone. A picture: nothing in it can
 * be pressed, and it reads as its label, a figure.
 */

function Frame({
  label,
  w,
  n,
  foot = false,
  className,
  children,
}: {
  label: string
  /** Its width in em, as drawn; in a narrow place, `n`. */
  w: number
  n: number
  /** Running off its foot, as a screenshot does. */
  foot?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <figure className={cx(p.frame, foot && p.foot, className)} aria-label={label} data-nosnippet>
      <div className={p.art} style={{ '--w': w, '--n': n } as CSSProperties} aria-hidden="true">
        {children}
      </div>
    </figure>
  )
}

/** A window's own bar: its three buttons, and what it holds. */
function Bar({ children, end }: { children?: ReactNode; end?: ReactNode }) {
  return (
    <div className={p.bar}>
      <span className={p.dots}>
        <i />
        <i />
        <i />
      </span>
      {children}
      {end && <span className={p.barEnd}>{end}</span>}
    </div>
  )
}

/** A project's tab in the bar. */
const Tab = ({ name, ink, on = false }: { name: string; ink: string; on?: boolean }) => (
  <span className={cx(p.tab, on && p.on)}>
    <i style={{ background: ink }} />
    {name}
  </span>
)

const Tabs = () => (
  <>
    <span className={p.tab}>
      <Logo size={12} className={p.logo} />
      Home
    </span>
    <Tab name="Tally" ink="#2f6f7a" on />
    <Tab name="Halyard" ink="#b4532a" />
  </>
)

/* ---- 0.5.0: Althar on Windows, the seven new agents joining the three ---- */

const FIRST_THREE = 3

function Windows() {
  return (
    <Frame
      label="Althar on Windows, its agents: Claude Code, Codex and OpenCode, and seven new ones: GitHub Copilot, Junie, Grok Build, Kimi Code, Mistral Vibe, Qwen Code and Google Antigravity"
      w={66}
      n={31}
      className={p.screen}
    >
      <div className={p.desk}>
        <div className={cx(p.win, p.winOnDesk)}>
          <Bar end={<span className={p.crumb}>Settings</span>}>
            <Tabs />
          </Bar>
          <div className={p.agentsPage}>
            <div className={p.pageHead}>
              <b>Agents</b>
              <span>Each one asks before it acts.</span>
            </div>
            <ul className={p.agents}>
              {AGENTS.map((agent, i) => (
                <li key={agent.id} className={cx(i >= FIRST_THREE && p.joined)}>
                  <span className={p.mk}>
                    <AgentMark agent={agent.id} size={16} />
                  </span>
                  <span className={p.who}>
                    <b>{agent.name}</b>
                    <span>{agent.signIn}</span>
                  </span>
                  {i >= FIRST_THREE ? <em className={p.new}>New</em> : <em className={p.ready}>Signed in</em>}
                </li>
              ))}
            </ul>
          </div>
        </div>
        {/* The taskbar along the screen's foot: Start, search, Althar open and running, and the time. */}
        <div className={p.taskbar}>
          <span className={p.tasks}>
            <span className={p.task}>
              <OsMark id="windows" size={14} />
            </span>
            <span className={p.search}>
              <Icon name="search" size={12} />
              Search
            </span>
            <span className={cx(p.task, p.open)}>
              <Logo size={14} className={p.logo} />
            </span>
            <span className={p.task}>
              <Icon name="folder" size={14} />
            </span>
            <span className={p.task}>
              <Icon name="terminal" size={14} />
            </span>
          </span>
          <span className={p.tray}>
            <span>ENG</span>
            <span className={p.clock}>
              18:18
              <br />
              20/10/2026
            </span>
          </span>
        </div>
      </div>
    </Frame>
  )
}

/* ---- 0.4.1: a pull request written for its reviewer ---- */

function Reviewer() {
  return (
    <Frame
      label="A pull request Althar opened, its description written for a reviewer: why, what changed, and how it was checked"
      w={56}
      n={30}
      foot
    >
      <div className={cx(p.win, p.page)}>
        <div className={p.prHead}>
          <span className={p.state}>
            <Icon name="pr" size={12} />
            Open
          </span>
          <b>Return 409 when a refund idempotency key is reused</b>
          <span className={p.prNo}>#1191</span>
        </div>
        <div className={p.prMeta}>
          <span className={p.by}>
            <Logo size={11} className={p.logo} />
            Althar opened this for task 416
          </span>
          <code>tal-416-reused-key → main</code>
          <span className={p.diff}>
            <ins>+212</ins> <del>−41</del>
          </span>
        </div>
        <div className={p.md}>
          <h4>Why</h4>
          <p>
            A partner retrying a refund with the same key got a second refund. A reused key should get the first one back, as Stripe does.
          </p>
          <h4>What changed</h4>
          <ul>
            <li>A refund keeps the idempotency key it was made with.</li>
            <li>
              A reused key answers <code>409</code> with the first refund’s id.
            </li>
            <li>A migration adds a unique index on partner and key.</li>
          </ul>
          <h4>How it was checked</h4>
          <ul className={p.checked}>
            <li>
              <Icon name="check" size={12} />
              <span>
                <code>pnpm test refunds</code>: 48 passed, 3 of them new, for reused keys.
              </span>
            </li>
            <li>
              <Icon name="check" size={12} />
              <span>Replayed last week’s partner retries on staging: no second refunds.</span>
            </li>
          </ul>
        </div>
      </div>
    </Frame>
  )
}

/* ---- 0.4.0: Report a problem, and what goes with it ---- */

const SENT = [
  ['Version', 'Althar 0.4.0'],
  ['System', 'macOS 15.1, Apple silicon'],
  ['Logs', 'The last 500 lines of each'],
  ['Folders and keys', 'Taken out'],
] as const

function Switch() {
  return (
    <span className={p.switch}>
      <i />
    </span>
  )
}

function Report() {
  const t = reportProblemText
  return (
    <Frame
      label="Report a problem: what happened, in your words, with a screenshot of the window and Althar’s logs, and a list of everything that goes with it"
      w={52}
      n={30}
      className={p.dim}
    >
      <div className={p.behind}>
        <div className={cx(p.win, p.ghost)}>
          <Bar>
            <Tabs />
          </Bar>
          <div className={p.lanes}>
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      </div>
      <div className={p.dialog}>
        <b className={p.dialogTitle}>{t.title}</b>
        <span className={p.fieldLabel}>{t.what}</span>
        <div className={p.area}>
          Pushing task 432 failed with “remote rejected”, and its card stayed on Pushing.
          <i className={p.caret} />
        </div>
        <div className={p.option}>
          <Switch />
          <span className={p.optionWords}>
            <b>{t.screenshot}</b>
          </span>
          <span className={p.thumb}>
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className={p.option}>
          <Switch />
          <span className={p.optionWords}>
            <b>{t.logs}</b>
            <span>{t.logsNote}</span>
            <span className={p.see}>
              {t.hideSent}
              <Icon name="chevronU" size={10} />
            </span>
            <span className={p.sent}>
              {SENT.map(([k, v]) => (
                <span key={k}>
                  <i>{k}</i>
                  {v}
                </span>
              ))}
            </span>
          </span>
        </div>
        <div className={p.actions}>
          <span className={p.quiet}>{t.cancel}</span>
          <span className={p.fill}>{t.send}</span>
        </div>
      </div>
    </Frame>
  )
}

/* ---- 0.3.0: Run, split, and everything a project runs ---- */

const RUNS = [
  { name: 'web', command: 'pnpm dev', at: 'localhost:5173' },
  { name: 'api', command: 'pnpm --filter api start', at: 'localhost:8080' },
  { name: 'worker', command: 'pnpm --filter worker start' },
  { name: 'storybook', command: 'pnpm storybook' },
] as const

/** The Run button's words as 0.3.0 said them: the picture is of that release, not of Run now. */
const RUN_THEN = {
  run: (label: string) => `Run ${label}`,
  label: 'What it runs',
  resting: 'Not running',
  add: 'Add something to run…',
  edit: 'Edit the list…',
  note: 'Checked ones are running. Pick one to start or stop it.',
}

function Run() {
  const t = RUN_THEN
  return (
    <Frame
      label="Run, split: a press runs web, and its list starts or stops each thing the project runs: web and the API running, the worker and Storybook not"
      w={50}
      n={30}
      foot
    >
      <div className={cx(p.win, p.runWin)}>
        <Bar
          end={
            <span className={p.split}>
              <span className={p.splitMain}>
                <Icon name="play" size={11} />
                {t.run('web')}
              </span>
              <span className={p.splitMore}>
                <Icon name="chevronD" size={11} />
              </span>
            </span>
          }
        >
          <Tabs />
        </Bar>
        <div className={p.runBody}>
          <div className={p.lanes}>
            <i />
            <i />
            <i />
          </div>
          <div className={p.menu}>
            <span className={p.menuLabel}>{t.label}</span>
            {RUNS.map((run, i) => {
              const on = 'at' in run
              return (
                <span key={run.name} className={cx(p.item, on && p.running, i === 1 && p.hover)}>
                  <span className={p.box}>{on && <Icon name="check" size={10} />}</span>
                  <span className={p.itemWords}>
                    <b>{run.name}</b>
                    <code>{run.command}</code>
                  </span>
                  <span className={p.itemState}>
                    {on ? (
                      <>
                        <i className={p.dot} />
                        {run.at}
                      </>
                    ) : (
                      t.resting
                    )}
                  </span>
                </span>
              )
            })}
            <span className={p.sep} />
            <span className={p.plain}>{t.add}</span>
            <span className={p.plain}>{t.edit}</span>
            <span className={p.menuNote}>{t.note}</span>
          </div>
        </div>
      </div>
    </Frame>
  )
}

/* ---- 0.2.0: a finished task, with its evidence ---- */

function Evidence() {
  return (
    <Frame
      label="A finished task: what it built, the evidence its lead showed (two screenshots and a test run), what it couldn’t check, and the reviewer’s word"
      w={60}
      n={30}
      foot
    >
      <div className={cx(p.win, p.page)}>
        <div className={p.done}>
          <span className={p.doneMark}>
            <Icon name="check" size={12} />
          </span>
          <span className={p.doneWords}>
            <b>Finished</b>
            <span>Task 416 · Return 409 when a refund idempotency key is reused</span>
          </span>
        </div>
        <span className={p.section}>What it built</span>
        <p className={p.built}>A reused idempotency key now gets the first refund back, with 409, and a unique index keeps it that way.</p>
        <span className={p.section}>Evidence</span>
        <div className={p.evidence}>
          <span className={p.shot}>
            <span className={p.shotPic}>
              <span className={p.req}>
                <code>POST /v1/refunds</code>
                <b>409 Conflict</b>
                <code className={p.json}>{'{ "refund": "re_8Hk2…", "reused": true }'}</code>
              </span>
            </span>
            <span className={p.caption}>The second request, answered</span>
          </span>
          <span className={p.shot}>
            <span className={p.shotPic}>
              <span className={p.rows}>
                <b>Refunds · Acme</b>
                <span className={p.rowOn}>
                  <code>re_8Hk2…</code>
                  <span>€42.00</span>
                  <span>Refunded</span>
                </span>
                <span>
                  <code>re_3Pq9…</code>
                  <span>€18.50</span>
                  <span>Refunded</span>
                </span>
              </span>
            </span>
            <span className={p.caption}>Partner dashboard: one refund</span>
          </span>
          <span className={cx(p.shot, p.term)}>
            <span className={p.shotPic}>
              <span className={p.out}>
                <code>
                  <span className={p.prompt}>$</span> pnpm test refunds
                </code>
                <code className={p.pass}>✓ 48 passed</code>
                <code className={p.faint}>3 new · 2.1s</code>
              </span>
            </span>
            <span className={p.caption}>Test run</span>
          </span>
        </div>
        <span className={p.section}>Couldn’t check</span>
        <p className={p.couldnt}>Refunds made before the index: staging has none with a reused key.</p>
        <div className={p.reviewed}>
          <span className={p.mk}>
            <BrandMark brand={Brand.Codex} size={14} />
          </span>
          <span>
            <b>Reviewed by Codex.</b> Read the evidence; the reused-key test covers both partners.
          </span>
        </div>
      </div>
    </Frame>
  )
}

/* ---- 0.1.0: the coordinator plans what you asked for ---- */

const PLANNED = [
  { title: 'Receive Stripe’s refund webhooks', lead: Agent.Claude, review: Agent.Codex },
  { title: 'Post each refund to the ledger', lead: Agent.Codex, review: Agent.Claude },
  { title: 'Backfill the refunds missed so far', lead: Agent.OpenCode, review: Agent.Codex },
] as const

const NAME = Object.fromEntries(AGENTS.map((a) => [a.id, a.name])) as Record<Agent, string>

function Plan() {
  return (
    <Frame
      label="You ask for refunds to follow Stripe’s webhooks; the coordinator plans three tasks, each with a lead and a review"
      w={60}
      n={30}
      foot
    >
      <div className={cx(p.win, p.page, p.thread)}>
        <div className={p.you}>Refunds should follow Stripe’s webhooks, and the ledger has to stay in step.</div>
        <div className={p.coord}>
          <span className={p.coordMark}>
            <Logo size={13} className={p.logo} />
          </span>
          <span className={p.coordWords}>
            <b>Coordinator</b>
            <span>Three tasks, each with a lead and a review. The ledger waits for the webhooks.</span>
          </span>
        </div>
        <ol className={p.planned}>
          {PLANNED.map((task, i) => (
            <li key={task.title}>
              <span className={p.no}>{i + 1}</span>
              <b>{task.title}</b>
              <span className={p.roles}>
                <span>
                  <i>Lead</i>
                  <span className={p.mk}>
                    <AgentMark agent={task.lead} size={14} />
                  </span>
                  {NAME[task.lead]}
                </span>
                <span>
                  <i>Review</i>
                  <span className={p.mk}>
                    <AgentMark agent={task.review} size={14} />
                  </span>
                  {NAME[task.review]}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <div className={p.actions}>
          <span className={p.quiet}>Change the plan</span>
          <span className={p.fill}>Start</span>
        </div>
      </div>
    </Frame>
  )
}

/* ---- 0.6.0: plan usage, in light and in dark ---- */

const PLANS = [
  { agent: Agent.Claude, account: 'Max', window: '5 hours', left: 38, until: '14:00' },
  { agent: Agent.Codex, account: 'Pro', window: '5 hours', left: 64, until: '15:20' },
  { agent: Agent.Kimi, account: null, window: 'Week', left: 90, until: 'Mon 09:00' },
  { agent: Agent.Grok, account: null, window: 'Week', left: 96, until: 'Thu 18:00' },
] as const

/** The window's bar with the plans' gauge, and the peek it opens: each agent, least room first. */
function PlanPeek() {
  const t = planPeekText
  const tightest = PLANS[0]
  return (
    <div className={cx(p.win, p.planWin)}>
      <Bar
        end={
          <span className={p.gauge}>
            <span className={p.track}>
              <i style={{ width: `${tightest.left}%` }} />
            </span>
            {t.share(tightest.left)}
          </span>
        }
      >
        <Tabs />
      </Bar>
      <div className={p.peek}>
        <div className={p.peekHead}>
          <b>{t.heading}</b>
          <span>{t.level.down(NAME[tightest.agent])}</span>
        </div>
        {PLANS.map((plan) => (
          <div key={plan.agent} className={p.plan}>
            <span className={p.mk}>
              <AgentMark agent={plan.agent} size={14} />
            </span>
            <span className={p.planWho}>
              <b>{NAME[plan.agent]}</b>
              <span>{plan.account ? `${plan.account} · ${plan.window}` : plan.window}</span>
            </span>
            <span className={p.planBar}>
              <i style={{ width: `${plan.left}%` }} />
            </span>
            <span className={p.planLeft}>
              <b>{t.left(plan.left)}</b>
              <span>{t.until(plan.until)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** The same peek by day and by night, the line between them lit. */
function Plans() {
  return (
    <Frame
      label="Plan usage, in light and in dark: Claude Code has 38% of its five hours left until 14:00, Codex 64%, Kimi Code 90% of its week, Grok Build 96%"
      w={52}
      n={30}
      foot
      className={p.dayNight}
    >
      <PlanPeek />
      <div className={p.seam} />
      <div className={p.day}>
        <PlanPeek />
      </div>
    </Frame>
  )
}

/* ---- 0.6.0: automations, as the homepage draws them ---- */

function Automations() {
  return (
    <figure
      className={p.drawn}
      aria-label="An automation: weekdays at 07:00, review each new pull request, with Opus 5.5 as its lead, on this computer"
    >
      <Fragment source={automations} tone="dark" className={p.drawnStage} />
    </figure>
  )
}

/* ---- 0.7.0: a review read three times, its findings at their lines, and the seal ---- */

/** A line of the diff: its number, added or taken out, and its code in runs of one colour. */
interface DiffLine {
  no: number
  sign?: '+' | '-'
  code: readonly (string | readonly [kind: 'k' | 'f' | 's', text: string])[]
}

const DIFF: readonly DiffLine[] = [
  { no: 38, code: [['k', 'export async function '], ['f', 'refund'], '(req: RefundRequest) {'] },
  { no: 39, code: ['  ', ['k', 'const '], 'key = req.headers[', ['s', "'idempotency-key'"], ']'] },
  { no: 40, sign: '-', code: ['  ', ['k', 'const '], 'prior = ', ['k', 'await '], 'refunds.', ['f', 'find'], '(key)'] },
  { no: 40, sign: '+', code: ['  ', ['k', 'const '], 'prior = ', ['k', 'await '], 'refunds.', ['f', 'find'], '(req.partner, key)'] },
  { no: 41, sign: '+', code: ['  ', ['k', 'if '], '(prior) ', ['k', 'return '], ['f', 'conflict'], '(prior)'] },
  { no: 42, code: ['  ', ['k', 'const '], 'refund = ', ['k', 'await '], 'stripe.refunds.', ['f', 'create'], '({'] },
  { no: 43, sign: '+', code: ['    idempotencyKey: key,'] },
  { no: 44, code: ['    amount: req.amount,'] },
  { no: 45, code: ['  })'] },
  { no: 46, sign: '+', code: ['  ', ['k', 'await '], 'refunds.', ['f', 'save'], '(req.partner, key, refund)'] },
  { no: 47, code: ['  ', ['k', 'return '], ['f', 'ok'], '(refund)'] },
]

/** The two findings, each under the line it is about, and what the lead did. */
const NOTES = [
  {
    after: 4,
    weight: 'Major',
    heavy: true,
    title: 'A reused key with a new amount still gets the first refund',
    claim: 'A partner that changes the amount on a retry is told it succeeded.',
    state: 'Fixed',
    answer: ['Compares the amount too, and answers 422 when it differs.', '3f2a1c4'],
  },
  {
    after: 9,
    weight: 'Minor',
    heavy: false,
    title: 'Two retries at once can both miss find() and save twice',
    claim: 'Nothing stops the second save.',
    state: 'Kept',
    answer: ['The unique index on partner and key refuses the second.', null],
  },
] as const

const SEAL = `data:image/svg+xml,${encodeURIComponent(sealSvg('ring', { model: 'Opus 5.5', sha: '3f2a1c4', passes: 3, date: '2026-11-04' }, 'dark'))}`

/*
 * The beats, by when each starts, in ms of a loop: the first pass reads the
 * change and raises two findings; the second sees one fixed and one kept;
 * the third finds nothing left, and the pull request takes its seal. Then
 * it holds, and clears for the next loop.
 */
const BEATS = [0, 1300, 2100, 3400, 4300, 5100, 6400, 7900, 13600] as const
const LOOP = 14400
const SEALED = 7
const SCANS: readonly number[] = [0, 3, 6]

/** The beat it is on: it plays only while on screen, in a shown tab, with motion allowed; otherwise it rests sealed. */
function useBeat(ref: { readonly current: HTMLElement | null }): number {
  const [beat, setBeat] = useState(SEALED)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const still = matchMedia('(prefers-reduced-motion: reduce)')
    // It starts where the drawing rests, sealed, so nothing jumps when it wakes.
    let t: number = BEATS[SEALED]
    let since = 0
    let timer = 0
    let seen = false
    const step = () => {
      const now = performance.now()
      t = (t + now - since) % LOOP
      since = now
      const at = BEATS.findLastIndex((start) => start <= t)
      setBeat(at)
      timer = window.setTimeout(step, (BEATS[at + 1] ?? LOOP) - t + 1)
    }
    const sync = () => {
      window.clearTimeout(timer)
      if (seen && !document.hidden && !still.matches) {
        since = performance.now()
        step()
      } else if (still.matches) setBeat(SEALED)
    }
    const io = new IntersectionObserver((seen_) => {
      seen = seen_.at(-1)?.isIntersecting ?? false
      sync()
    })
    io.observe(el)
    document.addEventListener('visibilitychange', sync)
    still.addEventListener('change', sync)
    return () => {
      window.clearTimeout(timer)
      io.disconnect()
      document.removeEventListener('visibilitychange', sync)
      still.removeEventListener('change', sync)
    }
  }, [ref])
  return beat
}

function Findings() {
  const ref = useRef<HTMLDivElement>(null)
  const beat = useBeat(ref)
  const out = beat === BEATS.length - 1
  const pass = beat < 3 || out ? 1 : beat < 6 ? 2 : 3
  const shown = (from: number) => beat >= from && !out
  const notes = [
    { ...NOTES[0], shown: shown(1), settled: shown(4) },
    { ...NOTES[1], shown: shown(2), settled: shown(5) },
  ]
  const sealed = shown(SEALED)
  return (
    <Frame
      label="A review read in three passes: two findings at their lines, one fixed in 3f2a1c4 and one kept with the lead’s reason, and the pull request sealed, reviewed by Opus 5.5 in 3 passes"
      w={62}
      n={32}
      foot
      className={p.reviewed7}
    >
      <div ref={ref} className={p.rvStage} data-sealed={sealed}>
        <div className={cx(p.win, p.rvWin)}>
          <Bar>
            <Tabs />
          </Bar>
          <div className={p.rvHead}>
            <code>src/refunds/idempotency.ts</code>
            <span className={p.diff}>
              <ins>+5</ins> <del>−1</del>
            </span>
            <span className={p.rvPass}>
              <span className={p.mk}>
                <AgentMark agent={Agent.Claude} size={13} />
              </span>
              <span key={pass} className={p.rvPassWords}>
                {sealed ? 'Opus 5.5 · nothing left to change' : `Opus 5.5 · pass ${pass} of 3`}
              </span>
            </span>
          </div>
          <div className={p.rvCode}>
            {SCANS.includes(beat) && <i key={beat} className={p.rvScan} />}
            {DIFF.map((line, i) => (
              <div key={i} className={p.rvRows}>
                <div className={p.rvLine} data-sign={line.sign}>
                  <span className={p.rvNo}>{line.no}</span>
                  <span className={p.rvSign}>{line.sign ?? ''}</span>
                  <code>
                    {line.code.map((run, j) =>
                      typeof run === 'string' ? (
                        run
                      ) : (
                        <span key={j} className={p[run[0]]}>
                          {run[1]}
                        </span>
                      ),
                    )}
                  </code>
                </div>
                {notes
                  .filter((note) => note.after === i)
                  .map((note) => (
                    <div key={note.title} className={p.rvFold} data-shown={note.shown}>
                      <div className={p.rvNote} data-settled={note.settled}>
                        <span className={p.rvNoteHead}>
                          <span className={note.heavy && !note.settled ? p.rvHeavy : p.rvWeight}>{note.weight}</span>
                          <b>{note.title}</b>
                          <span className={p.rvState} data-fixed={note.state === 'Fixed'}>
                            {note.state === 'Fixed' && <Icon name="check" size={11} />}
                            {note.state}
                          </span>
                        </span>
                        <span className={p.rvSay}>
                          <span className={p.rvClaim}>{note.claim}</span>
                          <span className={p.rvAnswer}>
                            {note.answer[0]}
                            {note.answer[1] !== null && <code>{note.answer[1]}</code>}
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </div>
        <div className={p.rvPr} data-shown={sealed}>
          <span className={p.rvPrWords}>
            <span className={p.rvOpen}>
              <Icon name="pr" size={12} />
              Open
            </span>
            <b>Return 409 when a refund key is reused</b>
            <span className={p.rvPrLine}>Reviewed by Opus 5.5 in 3 passes, at 3f2a1c4</span>
          </span>
          <img className={p.rvSeal} src={SEAL} alt="" />
        </div>
      </div>
    </Frame>
  )
}

const PICTURES: Record<Picture, () => ReactNode> = {
  findings: Findings,
  plans: Plans,
  windows: Windows,
  reviewer: Reviewer,
  report: Report,
  run: Run,
  evidence: Evidence,
  plan: Plan,
  automations: Automations,
}

export function LogPicture({ picture }: { picture: Picture }) {
  const Drawn = PICTURES[picture]
  return <Drawn />
}
