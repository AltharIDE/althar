import { Brand, BrandMark, Logo } from '@charrette/ui'
import { useId, useSyncExternalStore, type ReactNode } from 'react'

import { cx } from '../lib/cx'
import s from './TaskGraph.module.css'

/*
 * Task 418 as its graph, drafted like a schedule on a drawing: each step is
 * a ruled cell with its number, its kind and what it came to, and the agent
 * that ran it. The security review raises one finding only you can settle,
 * and the call drops below the line while the review carries on. Review and
 * repair sit inside a bounded zone, the loop, going round until the review
 * passes: one lab checking another's work. Verify is a fresh agent testing
 * by hand in the running app. What's left is a note the project keeps.
 */

const W = 168
const H = 90
const NUM = 36
const HEAD = 26
const STEP = 222
const TOP = 172
const LOW = 404
const at = (i: number) => 20 + i * STEP
const X = { triage: at(0), implement: at(1), security: at(2), review: at(3), verify: at(4), note: at(5) } as const
const CALL = { x: X.security + W / 2, y: LOW + H / 2, r: 46 }
const MID = TOP + H / 2
const ZONE = { x: X.review - 26, y: TOP - 24, w: W + 52, h: LOW + H + 24 - (TOP - 24) }

interface CellProps {
  x: number
  y: number
  no: string
  kind: string
  status?: string
  mark?: ReactNode
  name: ReactNode
  sub?: string
  added?: boolean
  kept?: boolean
}

/** One step, as a ruled cell: its number, its kind and result, and who ran it. */
function Cell({ x, y, no, kind, status, mark, name, sub, added, kept }: CellProps) {
  return (
    <g className={cx(s.cell, added && s.added, kept && s.kept)}>
      <rect className={s.box} x={x} y={y} width={W} height={H} />
      <rect className={s.numCell} x={x} y={y} width={NUM} height={H} />
      <line x1={x + NUM} x2={x + NUM} y1={y} y2={y + H} />
      <line x1={x + NUM} x2={x + W} y1={y + HEAD} y2={y + HEAD} />
      <text className={s.no} x={x + NUM / 2} y={y + H / 2 + 5} textAnchor="middle">
        {no}
      </text>
      <text className={s.kind} x={x + NUM + 10} y={y + 17}>
        {kind}
      </text>
      {status && (
        <text className={s.status} x={x + W - 9} y={y + 17} textAnchor="end">
          {status}
        </text>
      )}
      {mark && (
        <g transform={`translate(${x + NUM + 10} ${y + HEAD + 13})`} className={s.mark}>
          {mark}
        </g>
      )}
      <text className={s.name} x={x + NUM + (mark ? 32 : 10)} y={y + HEAD + 26}>
        {name}
      </text>
      {sub && (
        <text className={s.sub} x={x + NUM + 10} y={y + H - 12}>
          {sub}
        </text>
      )}
    </g>
  )
}

const noMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const subscribe = (cb: () => void) => {
  const q = window.matchMedia('(prefers-reduced-motion: reduce)')
  q.addEventListener('change', cb)
  return () => q.removeEventListener('change', cb)
}

export function TaskGraph() {
  const id = useId()
  const still = useSyncExternalStore(subscribe, noMotion, () => true)
  const heads = { ink: `${id}-ink`, live: `${id}-live`, you: `${id}-you` }
  const to = (m: string) => `url(#${m})`
  const right = (x: number) => x + W
  const c = (x: number) => x + W / 2
  const down = X.review + 58
  const up = X.review + W - 58
  return (
    <>
      <TaskList />
      <div className={s.scroll}>
        <p className={s.sr}>
          Task 418 as a graph: triage by the coordinator; implement, by the lead; a security review a rule added, on your own GPU, which
          raises one call for you; review and repair in a loop until the review passes, up to three rounds; verify, a fresh agent testing by
          hand in the running app; and a note the project keeps.
        </p>
        <svg className={s.svg} viewBox="0 0 1320 620" aria-hidden="true">
          <defs>
            {(
              [
                [heads.ink, s.headInk],
                [heads.live, s.headLive],
                [heads.you, s.headYou],
              ] as const
            ).map(([m, cls]) => (
              <marker
                key={m}
                id={m}
                viewBox="0 0 12 8"
                refX="11"
                refY="4"
                markerWidth="12"
                markerHeight="8"
                markerUnits="userSpaceOnUse"
                orient="auto-start-reverse"
              >
                <path d="M0 0.8 L12 4 L0 7.2 Z" className={cls} />
              </marker>
            ))}
          </defs>

          {/* the lead's span: it implements, runs the steps and settles what they find */}
          <g className={s.lead}>
            <path d={`M${X.implement} ${TOP - 44} V${TOP - 58} H${right(X.verify)} V${TOP - 44}`} />
            <text x={(X.implement + right(X.verify)) / 2} y={TOP - 68} textAnchor="middle">
              Lead · Claude Code · runs the steps and settles what they find
            </text>
          </g>

          {/* the loop, as a bounded zone round review and repair */}
          <g className={s.zone}>
            <rect x={ZONE.x} y={ZONE.y} width={ZONE.w} height={ZONE.h} />
            <text x={ZONE.x} y={ZONE.y + ZONE.h + 20}>
              Review loop · until it passes · up to 3 rounds
            </text>
          </g>

          {/* the line of work */}
          <g className={s.edges}>
            {[X.triage, X.implement, X.security, X.review, X.verify].map((x, i) => (
              <line key={x} x1={right(x)} x2={at(i + 1) - 1} y1={MID} y2={MID} markerEnd={to(heads.ink)} />
            ))}
          </g>
          <text className={s.edgeText} x={(right(X.review) + X.verify) / 2} y={MID - 10} textAnchor="middle">
            Pass
          </text>
          <text className={s.edgeText} x={(right(X.verify) + X.note) / 2} y={MID - 10} textAnchor="middle">
            3 of 3
          </text>

          {/* round and round */}
          <g className={s.loop}>
            <line x1={down} x2={down} y1={TOP + H} y2={LOW - 1} markerEnd={to(heads.live)} />
            <line x1={up} x2={up} y1={LOW} y2={TOP + H + 1} markerEnd={to(heads.live)} />
            {!still && (
              <>
                <circle r={3.5} cx={down} cy={TOP + H}>
                  <animateMotion dur="2.6s" repeatCount="indefinite" path={`M0 0 V${LOW - TOP - H}`} />
                </circle>
                <circle r={3.5} cx={up} cy={LOW}>
                  <animateMotion dur="2.6s" begin="1.3s" repeatCount="indefinite" path={`M0 0 V${-(LOW - TOP - H)}`} />
                </circle>
              </>
            )}
          </g>
          <text className={s.loopText} x={down - 10} y={(TOP + H + LOW) / 2 + 4} textAnchor="end">
            3 findings
          </text>
          <text className={s.loopText} x={up + 10} y={(TOP + H + LOW) / 2 + 4}>
            Again
          </text>

          {/* the call, off the line */}
          <g className={s.toCall}>
            <line x1={c(X.security)} x2={c(X.security)} y1={TOP + H} y2={CALL.y - CALL.r - 5} markerEnd={to(heads.you)} />
            <line x1={CALL.x + CALL.r + 5} x2={X.review - 1} y1={CALL.y} y2={CALL.y} markerEnd={to(heads.you)} />
          </g>
          <text className={s.callText} x={c(X.security) - 10} y={(TOP + H + CALL.y - CALL.r) / 2 + 4} textAnchor="end">
            Can’t settle it alone
          </text>
          <text className={s.callText} x={(CALL.x + CALL.r + X.review) / 2 - 8} y={CALL.y + 20} textAnchor="middle">
            Your answer
          </text>
          <g className={s.call}>
            {[CALL.r + 5, CALL.r].map((r) => (
              <path key={r} d={`M${CALL.x} ${CALL.y - r} L${CALL.x + r} ${CALL.y} L${CALL.x} ${CALL.y + r} L${CALL.x - r} ${CALL.y} Z`} />
            ))}
            <text className={s.callNo} x={CALL.x} y={CALL.y - 14} textAnchor="middle">
              04
            </text>
            <text className={s.callName} x={CALL.x} y={CALL.y + 5} textAnchor="middle">
              Your call
            </text>
            <text className={s.callWho} x={CALL.x} y={CALL.y + 21} textAnchor="middle">
              You
            </text>
          </g>

          <Cell
            x={X.triage}
            y={TOP}
            no="01"
            kind="Triage"
            mark={
              <g transform="translate(-1 -1)">
                <Logo size={17} />
              </g>
            }
            name="Coordinator"
            sub="6 notes attached"
          />
          <Cell
            x={X.implement}
            y={TOP}
            no="02"
            kind="Implement"
            status="Lead"
            mark={<BrandMark brand={Brand.ClaudeCode} size={15} />}
            name="Claude Code"
            sub="Opus 5"
          />
          <Cell
            x={X.security}
            y={TOP}
            no="03"
            kind="Security"
            status="By rule"
            mark={<BrandMark brand={Brand.Alibaba} size={15} />}
            name="Qwen3 Coder"
            sub="On your own GPU"
            added
          />
          <Cell
            x={X.review}
            y={TOP}
            no="05"
            kind="Review"
            status="Pass"
            mark={<BrandMark brand={Brand.Codex} size={15} />}
            name="Codex"
            sub="GPT-5.2"
          />
          <Cell
            x={X.review}
            y={LOW}
            no="06"
            kind="Repair"
            status="Added"
            mark={<BrandMark brand={Brand.ClaudeCode} size={15} />}
            name="Claude Code"
            sub="The lead"
            added
          />
          <Cell
            x={X.verify}
            y={TOP}
            no="07"
            kind="Verify"
            status="3 of 3"
            mark={<BrandMark brand={Brand.GeminiCli} size={15} />}
            name="Gemini CLI"
            sub="Fresh, by hand"
          />
          <Cell
            x={X.note}
            y={TOP}
            no="08"
            kind="Note"
            status="Settled"
            name={
              <>
                <tspan>Retry once,</tspan>
                <tspan x={X.note + NUM + 10} dy={17}>
                  then fail
                </tspan>
              </>
            }
            kept
          />
          <text className={s.keptText} x={X.note} y={TOP + H + 20}>
            Kept by the project
          </text>

          {/* verify tests by hand, in the running app */}
          <g className={s.manual}>
            <line className={s.pin} x1={c(X.verify)} x2={c(X.verify)} y1={TOP + H} y2={TOP + H + 30} />
            <g transform={`translate(${X.verify + 17} ${TOP + H + 30})`}>
              <rect className={s.window} width={W - 34} height={90} />
              <line x1={0} x2={W - 34} y1={15} y2={15} />
              {[9, 18, 27].map((x) => (
                <circle key={x} cx={x} cy={7.5} r={2.2} />
              ))}
              {[0, 1, 2].map((i) => (
                <g key={i} transform={`translate(12 ${28 + i * 18})`}>
                  <path className={s.tick} d="M0 5 L4 9 L11 0" />
                  <rect className={s.bar} x={18} y={1} width={i === 1 ? 58 : 76} height={6} />
                </g>
              ))}
              <path className={s.cursor} d="M100 50 L100 70 L105 65 L109 74 L112 72.5 L108 64 L115 64 Z" />
            </g>
            <text className={s.manualText} x={X.verify + 17} y={TOP + H + 142}>
              Tested by hand
            </text>
            <text className={s.manualSub} x={X.verify + 17} y={TOP + H + 158}>
              In the running app
            </text>
          </g>

          {/* the whole task, dimensioned */}
          <g className={s.dim}>
            <line x1={X.triage} x2={X.triage} y1={576} y2={604} />
            <line x1={right(X.note)} x2={right(X.note)} y1={576} y2={604} />
            <line x1={X.triage} x2={right(X.note)} y1={596} y2={596} />
            <line className={s.tick2} x1={X.triage - 5} x2={X.triage + 5} y1={601} y2={591} />
            <line className={s.tick2} x1={right(X.note) - 5} x2={right(X.note) + 5} y1={601} y2={591} />
            <text x={(X.triage + right(X.note)) / 2} y={586} textAnchor="middle">
              Task 418 · 8 steps · 4 labs · 2 review rounds · 1 call · 47 min
            </text>
          </g>
        </svg>
      </div>
    </>
  )
}

interface Row {
  no: string
  kind: string
  status?: string
  mark?: ReactNode
  name: string
  sub?: string
  added?: boolean
}

function Row({ no, kind, status, mark, name, sub, added }: Row) {
  return (
    <li className={cx(s.row, added && s.rowAdded)}>
      <span className={s.rowNo}>{no}</span>
      <span className={s.rowHead}>
        <b>{kind}</b>
        {status && <i>{status}</i>}
      </span>
      <span className={s.rowName}>
        {mark}
        {name}
      </span>
      {sub && <small>{sub}</small>}
    </li>
  )
}

/** The same graph, top to bottom, for narrow screens. Hidden from assistive technology: the drawing's description covers it. */
function TaskList() {
  return (
    <ol className={s.list} aria-hidden="true">
      <Row no="01" kind="Triage" mark={<Logo size={15} />} name="Coordinator" sub="6 notes attached" />
      <Row no="02" kind="Implement" status="Lead" mark={<BrandMark brand={Brand.ClaudeCode} size={14} />} name="Claude Code" sub="Opus 5" />
      <Row
        no="03"
        kind="Security"
        status="By rule"
        mark={<BrandMark brand={Brand.Alibaba} size={14} />}
        name="Qwen3 Coder"
        sub="On your own GPU"
        added
      />
      <li className={s.aside}>
        <span className={s.callMark} />
        <span>
          <b>04 · Your call.</b> The security review can’t settle one finding alone, so it comes to you. Your answer goes to the repair.
        </span>
      </li>
      <li className={s.zoneList}>
        <p className={s.zoneHead}>Loop · until it passes · 3 rounds max</p>
        <ol>
          <Row
            no="05"
            kind="Review"
            status="Pass"
            mark={<BrandMark brand={Brand.Codex} size={14} />}
            name="Codex"
            sub="Round 1: 3 findings"
          />
          <Row
            no="06"
            kind="Repair"
            status="Added"
            mark={<BrandMark brand={Brand.ClaudeCode} size={14} />}
            name="Claude Code"
            sub="Then review again"
            added
          />
        </ol>
      </li>
      <Row
        no="07"
        kind="Verify"
        status="3 of 3"
        mark={<BrandMark brand={Brand.GeminiCli} size={14} />}
        name="Gemini CLI"
        sub="Tested by hand, in the running app"
      />
      <li className={cx(s.row, s.rowKept)}>
        <span className={s.rowNo}>08</span>
        <span className={s.rowHead}>
          <b>Note</b>
          <i>Settled</i>
        </span>
        <span className={s.rowName}>Retry once, then fail</span>
        <small>Kept by the project</small>
      </li>
    </ol>
  )
}
