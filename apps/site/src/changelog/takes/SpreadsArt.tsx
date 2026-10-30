import { EvidenceKind, Finished, Icon } from '@althar/ui'
import { type CSSProperties, type ReactNode, useRef } from 'react'

import { SHOT_AFTER, SHOT_BEFORE } from '../../../../../packages/ui/src/fixtures/shots'
import { Agent } from '../../content/agents'
import { Launch } from '../../home/bodies/kit/app'
import { useRestAway } from '../../home/bodies/kit/seen'
import { Shot } from '../../home/bodies/kit/Shot'
import { cx } from '../../lib/cx'
import { AgentMark } from '../../shared/AgentMark'
import { OsMark } from '../../shared/OsMark'
import type { Art as ArtName } from './SpreadsLooks'
import a from './SpreadsArt.module.css'

/*
 * Each spread's picture of its release's biggest change. Four are drawn as
 * an interface lit by one light, as the homepage's are, at any width (in
 * the stage's own units): the keys of 0.5 lit from below, a crash report
 * having what's yours taken out, Report a problem reached from three
 * places, and the split Run button's list beside Allow everything. Two are
 * pieces of the app itself, drawn by its own components: a finished task's
 * evidence, and the lead's plan. Where they move, they loop gently, rest
 * out of sight, and hold still with motion reduced.
 */

const at = (i: number) => ({ '--i': i }) as CSSProperties

/** A drawing's stage: its own units, its ground, and its label for assistive technology. */
function Stage({ tone, label, className, children }: { tone: 'dark' | 'light'; label: string; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  useRestAway(box)
  return (
    <div ref={box} className={cx(a.stage, tone === 'dark' ? a.dark : a.light, className)} role="img" aria-label={label}>
      <div className={a.inner} aria-hidden="true">
        <span className={a.dots} />
        {children}
      </div>
    </div>
  )
}

/* ---- 0.5: the keys, lit from below where they're new ---- */

const KEYS: readonly { agent: Agent; name: string; fresh?: true }[] = [
  { agent: Agent.Claude, name: 'Claude Code' },
  { agent: Agent.Codex, name: 'Codex' },
  { agent: Agent.OpenCode, name: 'OpenCode' },
  { agent: Agent.Copilot, name: 'GitHub Copilot', fresh: true },
  { agent: Agent.Junie, name: 'Junie', fresh: true },
  { agent: Agent.Grok, name: 'Grok Build', fresh: true },
  { agent: Agent.Kimi, name: 'Kimi Code', fresh: true },
  { agent: Agent.Mistral, name: 'Mistral Vibe', fresh: true },
  { agent: Agent.Qwen, name: 'Qwen Code', fresh: true },
  { agent: Agent.Antigravity, name: 'Antigravity', fresh: true },
]

function Keys({ label }: { label: string }) {
  let lit = 0
  return (
    <Stage tone="dark" label={label} className={a.keysStage}>
      <span className={a.pool} />
      <div className={a.deck}>
        {KEYS.map((key) => (
          <span key={key.name} className={cx(a.key, key.fresh && a.on)} style={key.fresh ? at(lit++) : undefined}>
            <span className={a.cap}>
              <AgentMark agent={key.agent} size={24} className={a.mark} />
              <span className={a.legend}>{key.name}</span>
            </span>
          </span>
        ))}
        <span className={cx(a.key, a.on, a.wide)} style={at(lit)}>
          <span className={a.cap}>
            <span className={a.mark}>
              <OsMark id="windows" size={24} />
            </span>
            <span className={a.legend}>
              Windows <i>x64</i>
            </span>
          </span>
        </span>
      </div>
    </Stage>
  )
}

/* ---- 0.4.1: a crash report, with what's yours taken out as it goes ---- */

/** Something of yours in the report, and what stands in for it when it goes. */
function Mine({ was, now, i }: { was: string; now: string; i: number }) {
  return (
    <span className={a.mine} style={at(i)}>
      <span className={a.was}>{was}</span>
      <span className={a.now}>{now}</span>
    </span>
  )
}

function Masked({ label }: { label: string }) {
  return (
    <Stage tone="dark" label={label} className={a.maskedStage}>
      <span className={a.pool} />
      <div className={cx(a.card, a.crash)}>
        <div className={a.cardHead}>
          <span>Crash report</span>
          <span className={a.meta}>window · 0.4.1 · arm64</span>
        </div>
        <pre className={a.log}>
          <span className={a.errLine}>Error: ENOENT: no such file or directory</span>
          {'\n  open '}
          <Mine i={0} was="/Users/maya/Code/tally-api/NOTES.md" now="~/…/NOTES.md" />
          {'\n  at readNotes (main/notes.ts:41:18)'}
          {'\n  at openProject (main/projects.ts:112:9)'}
          {'\n'}
          <span className={a.errLine}>Caused by: push refused</span>
          {'\n  repository '}
          <Mine i={1} was="tally-api" now="[repository-1]" />
          {'\n  account    '}
          <Mine i={2} was="maya@tally.dev" now="[email]" />
          {'\n  Authorization: Bearer '}
          <Mine i={3} was="ghp_7Xq2Lr9Tz0VbKc4N" now="[secret]" />
        </pre>
      </div>
      <div className={cx(a.card, a.pr)}>
        <div className={a.cardHead}>
          <span>
            <Icon name="pr" size={12} /> Backfill idempotency keys on refunds
          </span>
          <span className={a.meta}>#1184</span>
        </div>
        <div className={a.prBody}>
          {['Why', 'What changed', 'How it was checked'].map((head, i) => (
            <div key={head} className={a.prPart}>
              <b>{head}</b>
              <i style={{ width: `${[86, 72, 64][i]}%` }} />
              <i style={{ width: `${[58, 80, 46][i]}%` }} />
            </div>
          ))}
        </div>
      </div>
    </Stage>
  )
}

/* ---- 0.4.0: Report a problem, from the menu, quick settings or a stuck step ---- */

const FROM = [
  { where: 'Althar menu', item: 'Report a problem…' },
  { where: 'Quick settings', item: 'Report a problem' },
  { where: 'A stuck step', item: 'Report a problem' },
] as const

function Report({ label }: { label: string }) {
  return (
    <Stage tone="dark" label={label} className={a.reportStage}>
      <span className={a.pool} />
      <svg className={a.wires} viewBox="0 0 100 62" preserveAspectRatio="none">
        <defs>
          <linearGradient id="spreads-wire" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#8a93ff" stopOpacity="0.15" />
            <stop offset="1" stopColor="#8a93ff" stopOpacity="0.85" />
          </linearGradient>
        </defs>
        {[15, 31, 47].map((y, i) => (
          <g key={y}>
            <path className={a.wire} d={`M28.5 ${y} C 36 ${y}, 36 31, 43 31`} />
            <path className={a.spark} d={`M28.5 ${y} C 36 ${y}, 36 31, 43 31`} pathLength={100} style={at(i)} />
          </g>
        ))}
      </svg>
      <div className={a.froms}>
        {FROM.map((from) => (
          <div key={from.where} className={cx(a.card, a.from)}>
            <span className={a.meta}>{from.where}</span>
            <span className={a.item}>
              <Icon name="bell" size={11} />
              {from.item}
            </span>
          </div>
        ))}
      </div>
      <div className={cx(a.card, a.dialog)}>
        <b className={a.dTitle}>Report a problem</b>
        <span className={a.dLabel}>What happened?</span>
        <span className={a.field}>
          The board says a task needs me, and home says nothing.
          <i className={a.caret} />
        </span>
        <span className={a.option}>
          <i className={a.switch} />
          <span>Include a screenshot of this window</span>
          <span className={a.thumb}>
            <i />
            <i />
            <i />
          </span>
        </span>
        <span className={a.option}>
          <i className={a.switch} />
          <span>
            Include logs
            <small>The last part of each log, with paths in your home folder and repository names hidden.</small>
          </span>
        </span>
        <span className={a.dFoot}>
          <span className={a.see}>See what’s sent</span>
          <span className={a.ghost}>Cancel</span>
          <span className={a.send}>Send</span>
        </span>
      </div>
    </Stage>
  )
}

/* ---- 0.3.0: the split Run button's list, and Allow everything ---- */

const RUNS = [
  { name: 'API server', what: 'localhost:4000 · 12m', state: 'on' },
  { name: 'Webhooks worker', what: '9m', state: 'on' },
  { name: 'Dashboard', what: 'Starting…', state: 'starting' },
] as const

function Run({ label }: { label: string }) {
  return (
    <Stage tone="light" label={label} className={a.runStage}>
      <span className={a.pool} />
      <div className={a.bar}>
        <span className={a.split}>
          <span className={a.runMain}>
            <i className={a.liveDot} />
            API server · localhost:4000
          </span>
          <span className={a.runMore}>
            <Icon name="chevronD" size={12} />
          </span>
        </span>
      </div>
      <div className={cx(a.card, a.menu)}>
        <span className={a.menuHead}>Running</span>
        {RUNS.map((run) => (
          <span key={run.name} className={a.menuRow}>
            <span className={cx(a.check, run.state === 'starting' && a.starting)}>
              {run.state === 'on' && <Icon name="check" size={10} />}
            </span>
            <span className={a.menuName}>{run.name}</span>
            <span className={a.menuWhat}>{run.what}</span>
          </span>
        ))}
        <span className={a.menuHead}>Not running</span>
        <span className={a.menuRow}>
          <span className={a.check} />
          <span className={a.menuName}>
            Ledger export tests
            <code>bun test ledger</code>
          </span>
          <span className={cx(a.menuWhat, a.failed)}>Failed 8m ago · exit 1</span>
        </span>
        <span className={a.menuRule} />
        <span className={cx(a.menuRow, a.menuPlain)}>Add something to run…</span>
      </div>
      <div className={cx(a.card, a.rules)}>
        <span className={a.rulesHead}>Rules</span>
        <span className={a.allow}>
          <span>
            <b>Allow everything</b>
            <small>For this project. Never still holds.</small>
          </span>
          <i className={a.switch} />
        </span>
        <span className={a.never}>
          <span>Never</span>
          <code>git push --force</code>
        </span>
      </div>
    </Stage>
  )
}

/* ---- 0.2.0: a finished task, with its evidence: the app's own card ---- */

const BUILT = [
  'A refused refund now says why, under the refund button: past 30 days, or already refunded.',
  '',
  '- The reason comes from the refunds API, in `api/refunds.ts`, and shows in `OrderPage.tsx`.',
  '- Try a refund on an order older than 30 days, then push.',
].join('\n')

function Evidence({ label }: { label: string }) {
  return (
    <Shot w={560} phoneW={380} maxScale={1.15} label={label} frame={a.window}>
      <div className={a.thread}>
        <Finished
          built={BUILT}
          pieces={[
            {
              id: 'before',
              kind: EvidenceKind.Screenshot,
              caption: 'Before: the refund button with no reason',
              form: 'picture',
              shot: SHOT_BEFORE,
            },
            {
              id: 'after',
              kind: EvidenceKind.Screenshot,
              caption: 'After: the reason under the refused refund',
              form: 'picture',
              shot: SHOT_AFTER,
            },
            {
              id: 'tests',
              kind: EvidenceKind.TestRun,
              caption: 'The refund tests, with the new refused case',
              form: 'output',
              command: 'bun run test refunds',
              exit: 0,
              lines: [' Test Files  1 passed (1)', '      Tests  2 passed (2)'],
            },
          ]}
          unverified={['Not tried against the live payment provider: no sandbox account here']}
        />
      </div>
    </Shot>
  )
}

/* ---- 0.1.0: the lead's plan for a task: the app's own card ---- */

function Plan({ label }: { label: string }) {
  return (
    <Shot w={640} phoneW={400} maxScale={1} label={label} frame={a.window}>
      <div className={a.thread}>
        <Launch from={false} />
      </div>
    </Shot>
  )
}

const ARTS: Record<ArtName, (props: { label: string }) => ReactNode> = {
  keys: Keys,
  masked: Masked,
  report: Report,
  run: Run,
  evidence: Evidence,
  plan: Plan,
}

export function Art({ art, label }: { art: ArtName; label: string }) {
  const Drawn = ARTS[art]
  return <Drawn label={label} />
}
