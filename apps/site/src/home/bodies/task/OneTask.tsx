import { Brand, BrandMark, Light } from '@althar/ui'
import { type ReactNode, useRef } from 'react'

import { LINKS } from '../../../content/facts'
import { cx } from '../../../lib/cx'
import { AgentMark } from '../../../shared/AgentMark'
import { Agent } from '../../../content/agents'
import { Get } from '../../../shared/Close'
import {
  Handover,
  IslandOpen,
  Issue231,
  Launch,
  Limit,
  MeridianBoard,
  Ready,
  RuleAdded,
  Task432,
  TwoLabReview,
  useAssembling,
} from '../kit/app'
import { Desktop, EditorWindow } from '../kit/Mac'
import { useSeen } from '../kit/seen'
import { Shot } from '../kit/Shot'
import t from '../kit/type.module.css'
import s from './OneTask.module.css'

/*
 * One task: the page follows task 432 from the sentence you type to the pull
 * request you merge, down one line, an hour of a Thursday. Each moment is a
 * time, a claim and the piece of the app that shows it, at the size the app
 * draws it. What it shows is everything the product does, in the order a
 * task meets it.
 */

function Beat({
  at,
  title,
  line,
  children,
  wide,
  last,
}: {
  at: string
  title: ReactNode
  line: ReactNode
  children?: ReactNode
  wide?: boolean
  last?: boolean
}) {
  const ref = useRef<HTMLLIElement>(null)
  const seen = useSeen(ref, 0.25)
  return (
    <li ref={ref} className={cx(s.beat, wide && s.wide, last && s.last, seen && s.seen)}>
      <time className={s.at}>{at}</time>
      <span className={s.dot} aria-hidden="true" />
      <div className={s.words}>
        <h3 className={cx(t.title, t.mid)}>{title}</h3>
        <p className={t.lead}>{line}</p>
      </div>
      {children && <div className={s.figure}>{children}</div>}
    </li>
  )
}

/** A piece of the app at the size it draws itself, on the page. */
function Piece({ children, label, w = 700, phoneW = 380 }: { children: ReactNode; label: string; w?: number; phoneW?: number }) {
  return (
    <Shot w={w} phoneW={phoneW} label={label} maxScale={1.1} frame={s.piece} align="start">
      <div className={s.pad}>{children}</div>
    </Shot>
  )
}

function Team() {
  const ref = useRef<HTMLDivElement>(null)
  const steps = useAssembling(useSeen(ref))
  return (
    <div ref={ref}>
      <Piece
        label="The lead's plan for task 432: Opus 5 implements, Codex dry-runs, Sonnet 5 and Gemini 3 Pro review, Sonnet 5 does the security review your rule asks for"
        phoneW={460}
      >
        <Launch steps={steps} />
      </Piece>
    </div>
  )
}

/** Which of your plans each step runs on: drawn as text, marks and hairlines. */
const ON = [
  { step: 'Implement', model: 'Opus 5', agent: Agent.Claude, plan: 'Claude Code · work', note: 'Max' },
  { step: 'Dry run on a copy', model: 'Codex', agent: Agent.Codex, plan: 'Codex · personal', note: 'Pro' },
  { step: 'Review', model: 'Sonnet 5', agent: Agent.Claude, plan: 'Claude Code · personal', note: 'Max' },
  { step: 'Review', model: 'Gemini 3 Pro', agent: Agent.OpenCode, plan: 'OpenCode · OpenRouter', note: 'key' },
  { step: 'Security review', model: 'Sonnet 5', agent: Agent.Claude, plan: 'Claude Code · personal', note: 'Max' },
]

function Plans() {
  return (
    <table className={s.plans}>
      <thead>
        <tr>
          <th scope="col">Step</th>
          <th scope="col">Model</th>
          <th scope="col">On your plan</th>
        </tr>
      </thead>
      <tbody>
        {ON.map((r, i) => (
          <tr key={i}>
            <th scope="row">{r.step}</th>
            <td>{r.model}</td>
            <td>
              <span className={s.plan}>
                <AgentMark agent={r.agent} size={16} />
                {r.plan}
                <em>{r.note}</em>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const HOSTS = [
  { brand: Brand.GitHub, name: 'GitHub' },
  { brand: Brand.GitLab, name: 'GitLab' },
  { brand: Brand.Bitbucket, name: 'Bitbucket' },
  { brand: Brand.Linear, name: 'Linear' },
  { brand: Brand.Jira, name: 'Jira' },
  { brand: Brand.Trello, name: 'Trello' },
]

export function OneTask() {
  return (
    <main id="main" tabIndex={-1} className={s.body}>
      <header className={s.top}>
        <p className={t.kicker}>
          <i aria-hidden="true" />
          Task 432 · Meridian · a Thursday
        </p>
        <h2 className={cx(t.title, t.big)}>
          One task, <b>start to finish.</b>
        </h2>
        <p className={t.lead}>
          From the sentence you type to the pull request you merge. Here is what Althar does in between, and how little of it needs you.
        </p>
      </header>

      <ol className={s.thread}>
        <Beat
          at="10:58"
          title={
            <>
              You say <b>what you want.</b>
            </>
          }
          line="In a sentence, to the project’s coordinator, or from an issue in your tracker. It reads the repositories and your rules before it plans."
        >
          <blockquote className={s.ask}>Backfill idempotency keys on the refunds made before PR 1184. MER-231 has the details.</blockquote>
          <Piece label="Linear issue MER-231: backfill idempotency keys on refunds created before PR 1184" w={560} phoneW={380}>
            <Issue231 />
          </Piece>
        </Beat>

        <Beat
          at="11:01"
          title={
            <>
              The lead <b>picks the team.</b>
            </>
          }
          line="A step at a time, the model that suits it, from whichever lab: Opus writes, Codex dry-runs, Sonnet and Gemini review. Your rule adds a security review. Change anyone before the countdown ends."
        >
          <Team />
        </Beat>

        <Beat
          at="11:02"
          title={
            <>
              On the plans <b>you already pay for.</b>
            </>
          }
          line="Each step runs on one of your own sign-ins: two Claude plans, three Codex accounts, a key in OpenCode. No new bill, nothing of ours in between."
        >
          <Plans />
        </Beat>

        <Beat
          at="11:31"
          title={
            <>
              Claude runs out. <b>Codex carries on.</b>
            </>
          }
          line="Same thread, same plan, same branch. It moves back after the reset, if it is still running."
        >
          <Piece label="Claude Code's usage limit reached, and task 431 carried on by Codex" w={700} phoneW={420}>
            <div className={s.stack}>
              <Limit />
              <Handover after />
            </div>
          </Piece>
        </Beat>

        <Beat
          at="11:44"
          title={
            <>
              Another lab <b>reviews it.</b>
            </>
          }
          line="Sonnet and Gemini read what Opus wrote, with your review instructions. The lead settles what it can. Two findings it can’t, so they are yours."
        >
          <Piece label="Review by Sonnet 5 and Gemini 3 Pro with three findings, two waiting on your call" phoneW={460}>
            <TwoLabReview />
          </Piece>
        </Beat>

        <Beat
          at="11:50"
          title={
            <>
              It goes back, <b>and round again.</b>
            </>
          }
          line="The lead fixes what review found and sends it to review again, until it comes back clean. Your rules add steps as the task learns what it touches."
        >
          <Piece label="Meridian's rule added a security review to task 432" phoneW={440}>
            <RuleAdded />
          </Piece>
        </Beat>

        <Beat
          at="12:31"
          title={
            <>
              You stay <b>in your editor.</b>
            </>
          }
          line="When something truly needs you, the island round the notch says so. Answer it there."
        >
          <div className={s.edge}>
            <Shot
              w={1440}
              h={900}
              crop={{ x: 300, y: 0, w: 840, h: 560 }}
              phone={{ x: 450, y: 0, w: 540, h: 560 }}
              label="The island round the notch, open over a code editor, with a permission to answer"
              frame={s.edgeFrame}
            >
              <Desktop wallpaper="dark" app="Code" island={<IslandOpen />}>
                <EditorWindow style={{ left: 120, top: 50, width: 1200, height: 780 }} />
              </Desktop>
            </Shot>
          </div>
        </Beat>

        <Beat
          at="12:41"
          title={
            <>
              Ready <b>for you to merge.</b>
            </>
          }
          line="A draft pull request on each repository it changed, checks passed, reviewed by a lab that didn’t write it. Merging stays yours."
          last
        >
          <div className={s.pair}>
            <Piece label="Task 432 done: every step finished" phoneW={420}>
              <Task432 />
            </Piece>
            <Piece label="Ready to accept: two pull requests, all checks passed" w={420} phoneW={380}>
              <Ready />
            </Piece>
          </div>
        </Beat>
      </ol>

      <section className={s.meanwhile} aria-labelledby="meanwhile-h">
        <div className={s.meanwhileHead}>
          <h2 id="meanwhile-h" className={t.title}>
            Meanwhile, <b>twelve more like it.</b>
          </h2>
          <p className={t.lead}>Every task, on one board per project: up next, running, what needs you, what’s settled.</p>
        </div>
        <div className={s.board}>
          <div className={s.boardLight} aria-hidden="true">
            <Light height={0.55} />
          </div>
          <Shot w={1360} h={760} phone={{ x: 0, y: 0, w: 560, h: 620 }} label="Meridian's board: four lanes of tasks" frame={s.boardFrame}>
            <div className={s.boardWin}>
              <MeridianBoard />
            </div>
          </Shot>
        </div>
      </section>

      <section className={s.end} aria-labelledby="end-h">
        <ul className={s.hosts} aria-label="Works with">
          {HOSTS.map((h) => (
            <li key={h.name}>
              <BrandMark brand={h.brand} size={22} />
              {h.name}
            </li>
          ))}
        </ul>
        <h2 id="end-h" className={cx(t.title, t.big)}>
          Hand it the next one. <b>Go do yours.</b>
        </h2>
        <Get tone="paper" />
        <footer className={s.foot}>
          <a href={LINKS.repo}>GitHub</a>
          <a href="/thesis">Thesis</a>
          <a href="/shifts">Shifts</a>
          <span>Free and open source · macOS first</span>
        </footer>
      </section>
    </main>
  )
}
