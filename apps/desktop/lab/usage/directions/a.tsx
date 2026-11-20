import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { BrandMark, Button, Caret, Model, Segmented, Tooltip, Unfold } from '@althar/ui'

import { Legend, PartsBar, TipLines, useTip } from '../charts.tsx'
import { AGENTS, NOW, PRESETS, STEPS, type Step, type StepKey, type Task } from '../facts.ts'
import {
  isChange,
  median,
  mergedOf,
  periodOf,
  quantile,
  spentIn,
  taskTokens,
  tasksIn,
  toMerge,
  tokensIn,
  weekShareOf,
} from '../measures.ts'
import type { DirectionProps } from '../page.tsx'
import { agentBrand, duration, modelInfo, money, moneyWhole, plural, points, tokens, when } from '../words.ts'
import sh from '../shared.module.css'
import s from './a.module.css'

/*
 * A · Receipts. What each piece of work cost, rather than what each day did:
 * every task of the period as a dot on one scale of dollars, a row of kinds
 * of work, so the cheap and the costly and the odd one out show at once; and
 * under it, a receipt for each, its steps with who ran them, their time, their
 * tokens and their cost, what its reviews found, and the share of each plan's
 * week it took. The coordinator's day is the one line that isn't a task.
 */

const STEP_COLOR: Readonly<Record<StepKey, string>> = {
  build: 'var(--t-3)',
  review: 'var(--project-indigo)',
  fix: 'var(--project-clay)',
  checks: 'var(--project-ochre)',
}

const OUTCOME = {
  merged: (task: Task) => `Merged ${task.pr === null ? '' : `#${task.pr} `}· ${duration(toMerge(task))} to merge`,
  branch: () => 'On its branch',
  answered: () => 'Answered',
  reviewed: () => 'Review posted',
  abandoned: () => 'Abandoned',
  open: (task: Task) => `At work · started ${when(task.startedAt)}`,
} as const

const stepName = (one: Step, all: ReadonlyArray<Step>) =>
  all.filter((each) => each.key === one.key).length > 1 ? `${STEPS[one.key]} ${one.round}` : STEPS[one.key]

/** Its cost, by step: the receipt's bar. */
const byStep = (task: Task) =>
  (['build', 'review', 'fix', 'checks'] as const).map((key) => ({
    key,
    value: task.steps.filter((one) => one.key === key).reduce((sum, one) => sum + one.cost, 0),
    color: STEP_COLOR[key],
  }))

const shareWords = (task: Task) => {
  const share = weekShareOf(task)
  return (Object.keys(share) as Array<keyof typeof share>)
    .filter((agent) => share[agent] > 0)
    .map((agent) => `~${points(share[agent])} of ${AGENTS[agent].plan}’s week`)
}

// ——— the dots ———

const LOW = 0.08
const HIGH = 700
const TICKS = [0.3, 1, 3, 10, 30, 100, 300]
const xOf = (cost: number) => (Math.log(Math.max(LOW, Math.min(HIGH, cost)) / LOW) / Math.log(HIGH / LOW)) * 100

const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  useLayoutEffect(() => {
    const node = ref.current
    if (node === null) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 900))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

function Dots({ tasks, picked, onPick }: { tasks: ReadonlyArray<Task>; picked: string | null; onPick: (id: string) => void }) {
  const tip = useTip()
  const [ref, width] = useWidth()
  const presets = (['change', 'small', 'prototype', 'review', 'chat'] as const).filter((preset) =>
    tasks.some((task) => task.preset === preset),
  )
  const dot = tasks.length > 600 ? 5 : tasks.length > 200 ? 6 : 8
  const side = 8
  return (
    <div className={s.dots}>
      {presets.map((preset) => {
        const its = tasks.filter((task) => task.preset === preset).sort((a, b) => a.cost - b.cost)
        const mid = median(its.map((task) => task.cost))
        // Each in its column of pixels, stacked out from the middle, the rest overlapping at the edge.
        const columns = new Map<number, number>()
        const placed = its.map((task) => {
          const column = Math.round(((xOf(task.cost) / 100) * width) / (dot + 1))
          const k = columns.get(column) ?? 0
          columns.set(column, k + 1)
          const level = Math.min(side, Math.ceil(k / 2)) * (k % 2 === 0 ? 1 : -1)
          return { task, left: xOf(task.cost), top: level * (dot + 1) }
        })
        const deep = Math.min(side, Math.ceil(Math.max(0, ...columns.values()) / 2))
        const height = (deep * 2 + 1) * (dot + 1) + 8
        return (
          <div key={preset} className={s.dotRow}>
            <div className={s.dotLabel}>
              {PRESETS[preset]}
              <span className={sh.quiet}> {its.length}</span>
            </div>
            <div ref={preset === presets[0] ? ref : undefined} className={s.dotField} style={{ height }}>
              {mid !== null && (
                <span className={s.median} style={{ left: `${xOf(mid)}%` }}>
                  <span className={s.medianLabel}>{money(mid)}</span>
                </span>
              )}
              {placed.map(({ task, left, top }) => (
                <button
                  key={task.id}
                  type="button"
                  className={s.dot}
                  data-picked={task.id === picked || undefined}
                  data-open={task.outcome === 'open' || undefined}
                  style={{ left: `${left}%`, top: `calc(50% + ${top}px)`, width: dot, height: dot }}
                  aria-label={`${task.title}, ${money(task.cost)}`}
                  onClick={() => onPick(task.id)}
                  {...tip(
                    <TipLines
                      title={task.title}
                      lines={[
                        `${money(task.cost)} · ${modelInfo(task.lead).short}${task.reviewer === null || task.preset === 'review' ? '' : ` → ${modelInfo(task.reviewer).short}`}`,
                        OUTCOME[task.outcome](task),
                      ]}
                    />,
                  )}
                />
              ))}
            </div>
          </div>
        )
      })}
      <div className={s.dotRow}>
        <div />
        <div className={s.axis}>
          {TICKS.map((tick) => (
            <span key={tick} style={{ left: `${xOf(tick)}%` }}>
              {tick < 1 ? money(tick) : `$${tick}`}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ——— a receipt ———

/** The plan whose week it took the most of, by its mark, and how much: the receipt's line says them all. */
function WeekShare({ task }: { task: Task }) {
  const share = weekShareOf(task)
  const agent = share.codex > share['claude-code'] ? 'codex' : 'claude-code'
  return (
    <Tooltip label={shareWords(task).join(' · ')}>
      <span className={s.share}>
        <BrandMark brand={agentBrand(agent)} size={11} />~{points(share[agent])} of week
      </span>
    </Tooltip>
  )
}

function Receipt({ task, open, onToggle }: { task: Task; open: boolean; onToggle: () => void }) {
  const tip = useTip()
  const t = taskTokens(task)
  const total = t.cached + t.uncached + t.written + t.output
  return (
    <li className={s.receipt} data-open={open || undefined} id={`receipt-${task.id}`}>
      <button type="button" className={s.row} aria-expanded={open} onClick={onToggle}>
        <Caret open={open} className={s.caret} />
        <span className={s.what}>
          <span className={s.title} title={task.title}>
            {task.title}
          </span>
          <span className={s.outcome}>
            {PRESETS[task.preset]} · {OUTCOME[task.outcome](task)}
          </span>
        </span>
        <span className={s.team}>
          <Model model={modelInfo(task.lead)} short />
          {task.reviewer !== null && task.preset !== 'review' && (
            <>
              <span className={sh.faint}>→</span>
              <Model model={modelInfo(task.reviewer)} short />
            </>
          )}
        </span>
        <span className={s.bar}>
          <PartsBar
            parts={byStep(task).map((part) => ({
              ...part,
              tip: <TipLines title={STEPS[part.key]} lines={[money(part.value)]} />,
            }))}
            height={6}
          />
        </span>
        <span className={s.cost}>
          <span className={s.dollars}>{money(task.cost)}</span>
          <WeekShare task={task} />
        </span>
      </button>
      <Unfold open={open}>
        <div className={s.detail}>
          <table className={s.steps}>
            <thead>
              <tr>
                <th>Step</th>
                <th>Model</th>
                <th className={s.r}>Time</th>
                <th className={s.r}>Tokens</th>
                <th className={s.r}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {task.steps.map((one, i) => {
                const found = one.findings ?? []
                return (
                  <tr key={i}>
                    <td>
                      <span className={s.stepName}>
                        <span className={s.stepSwatch} style={{ background: STEP_COLOR[one.key] }} />
                        {stepName(one, task.steps)}
                      </span>
                      {one.key === 'review' && (
                        <span className={s.found}>
                          {found.length === 0
                            ? 'Nothing found'
                            : `${plural(found.length, 'finding')}: ${(['blocking', 'major', 'minor', 'nit'] as const)
                                .map((sev) => [sev, found.filter((f) => f.severity === sev).length] as const)
                                .filter(([, n]) => n > 0)
                                .map(([sev, n]) => `${n} ${sev}`)
                                .join(', ')} · ${found.filter((f) => f.state === 'fixed').length} fixed`}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={s.stepModel}>
                        <Model model={modelInfo(one.model)} short />
                        <span className={sh.quiet}>{one.effort}</span>
                      </span>
                    </td>
                    <td className={s.r}>{duration(one.to - one.from)}</td>
                    <td
                      className={s.r}
                      {...tip(
                        <TipLines
                          title="Tokens"
                          lines={[
                            `${tokens(one.tokens.cached)} read from the cache`,
                            `${tokens(one.tokens.uncached)} not from the cache`,
                            `${tokens(one.tokens.written)} written to it`,
                            `${tokens(one.tokens.output)} output`,
                          ]}
                        />,
                      )}
                    >
                      {tokens(one.tokens.cached + one.tokens.uncached + one.tokens.written + one.tokens.output)}
                    </td>
                    <td className={s.r}>{money(one.cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <dl className={s.facts}>
            <div>
              <dt>Tokens</dt>
              <dd>
                {tokens(total)}, {Math.round((t.cached / Math.max(total, 1)) * 100)}% read from the cache · {tokens(t.output)} output
              </dd>
            </div>
            <div>
              <dt>Of your plans</dt>
              <dd>{shareWords(task).join(' · ')}</dd>
            </div>
            {task.outcome === 'merged' && (
              <div>
                <dt>To merge</dt>
                <dd>
                  {duration(toMerge(task))}: agents {duration(task.worked)}, checks {duration(task.checking)}, waiting on you{' '}
                  {duration(task.waited)}
                </dd>
              </div>
            )}
          </dl>
          <div className={s.open}>
            <Button size="small" variant="quiet" trailingIcon="arrow">
              Open task
            </Button>
          </div>
        </div>
      </Unfold>
    </li>
  )
}

// ——— the page ———

const PAGE = 25

export function Receipts({ range, scope }: DirectionProps) {
  const period = useMemo(() => periodOf(range), [range])
  const tasks = useMemo(() => tasksIn(period, scope), [period, scope])
  const spent = useMemo(() => spentIn(period, scope), [period, scope])
  const used = useMemo(() => tokensIn(period, scope), [period, scope])
  const [order, setOrder] = useState<'cost' | 'latest'>('cost')
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const [shown, setShown] = useState(PAGE)
  const [picked, setPicked] = useState<string | null>(null)

  const finished = tasks.filter((task) => task.outcome !== 'open')
  const merged = mergedOf(finished)
  const changes = merged.filter(isChange).map((task) => task.cost)
  const all = used.tokens.cached + used.tokens.uncached + used.tokens.written + used.tokens.output
  const sorted = [...tasks].sort((a, b) => (order === 'cost' ? b.cost - a.cost : (b.endedAt ?? NOW) - (a.endedAt ?? NOW)))
  const rows = sorted.slice(0, shown)
  const pickedTask = picked === null ? undefined : tasks.find((task) => task.id === picked)
  if (pickedTask !== undefined && !rows.includes(pickedTask)) rows.unshift(pickedTask)

  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const pick = (id: string) => {
    setPicked(id)
    setOpen((was) => new Set(was).add(id))
    requestAnimationFrame(() => document.getElementById(`receipt-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }

  return (
    <>
      <section className={sh.section}>
        <div className={sh.figures}>
          <div className={sh.figure}>
            <div className={sh.figLabel}>Finished</div>
            <div className={sh.figValue}>{finished.length.toLocaleString('en-GB')}</div>
            <div className={sh.figNote}>
              {merged.length} merged · {finished.filter((task) => task.outcome === 'abandoned').length} abandoned
            </div>
          </div>
          <div className={sh.figure}>
            <Tooltip label="What the same tokens would cost paid per use. Your plans cover them.">
              <div className={sh.figLabel}>
                At API prices <span className={sh.faint}>ⓘ</span>
              </div>
            </Tooltip>
            <div className={sh.figValue}>{moneyWhole(spent.total)}</div>
            <div className={sh.figNote}>
              Claude Code {money(spent['claude-code'])} · Codex {money(spent.codex)}
            </div>
          </div>
          <div className={sh.figure}>
            <div className={sh.figLabel}>Per merged change</div>
            <div className={sh.figValue}>{changes.length === 0 ? '—' : money(median(changes)!)}</div>
            <div className={sh.figNote}>
              {changes.length === 0 ? 'None merged' : `Middle half ${money(quantile(changes, 0.25)!)}–${money(quantile(changes, 0.75)!)}`}
            </div>
          </div>
          <div className={sh.figure}>
            <div className={sh.figLabel}>Tokens</div>
            <div className={sh.figValue}>{tokens(all)}</div>
            <div className={sh.figNote}>{Math.round((used.tokens.cached / Math.max(all, 1)) * 100)}% read from the cache</div>
          </div>
        </div>
      </section>

      <section className={sh.section}>
        <div className={sh.sectionHead}>
          <h2 className={sh.h2}>What each task cost</h2>
          <span className={sh.quiet} style={{ fontSize: 12 }}>
            At API prices · the line is the middle one
          </span>
        </div>
        {tasks.length === 0 ? (
          <p className={sh.empty}>No task finished in these days.</p>
        ) : (
          <Dots tasks={tasks} picked={picked} onPick={pick} />
        )}
      </section>

      <section className={sh.section}>
        <div className={sh.sectionHead}>
          <h2 className={sh.h2}>Receipts</h2>
          <Legend items={(['build', 'review', 'fix', 'checks'] as const).map((key) => ({ label: STEPS[key], color: STEP_COLOR[key] }))} />
          <Segmented
            label="Order"
            options={[
              { value: 'cost', label: 'Costliest' },
              { value: 'latest', label: 'Latest' },
            ]}
            value={order}
            onChange={(value) => {
              setOrder(value)
              setShown(PAGE)
            }}
          />
        </div>
        <ul className={s.receipts}>
          {rows.map((task) => (
            <Receipt key={task.id} task={task} open={open.has(task.id)} onToggle={() => toggle(task.id)} />
          ))}
          <li className={s.coordinator}>
            <span className={s.what}>
              <span className={s.title}>The coordinator and asides</span>
              <span className={s.outcome}>Not in a task</span>
            </span>
            <span className={s.cost}>
              <span className={s.dollars}>{money(spent.coordinator)}</span>
            </span>
          </li>
          {sorted.length > shown && (
            <li className={s.moreRow}>
              <Button size="small" variant="quiet" onClick={() => setShown((n) => n + PAGE)}>
                Show {Math.min(PAGE, sorted.length - shown)} more of {sorted.length}
              </Button>
            </li>
          )}
        </ul>
      </section>
    </>
  )
}
