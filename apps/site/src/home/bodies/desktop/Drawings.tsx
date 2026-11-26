import { Brand, BrandMark } from '@althar/ui'
import type { CSSProperties, ReactNode } from 'react'

import { cx } from '../../../lib/cx'
import { SignInPage } from '../kit/CanvasAtWork'
import { Shot } from '../kit/Shot'
import s from './Drawings.module.css'

/*
 * The flow's smaller features, drawn as the console's other drawn tiles are:
 * an interface lit by one light, on the cabin's warm dark (or, for the
 * skills, which the flow also draws large, the paper's light ground), every size taken
 * from the drawing's width so each reads the same at any size. The canvas
 * carries more, so it draws a little smaller (`mid`). Pictures: nothing in
 * them can be pressed, and each reads as its label.
 */

function Stage({ label, size, light, children }: { label: string; size: 'mid' | 'small'; light?: boolean; children: ReactNode }) {
  return (
    <div className={s.box} role="img" aria-label={label}>
      <div className={cx(s.stage, s[size], light && s.light)}>
        <div className={s.scene}>{children}</div>
      </div>
    </div>
  )
}

const mark = (brand: Brand) => (
  <span className={s.mk}>
    <BrandMark brand={brand} size={16} />
  </span>
)

/** The canvas: Tally's sign-in page as the lead drew it in the carousel (CanvasAtWork.tsx), at its second version, split with the brand on its left, the one before it behind, the comment that asked for it answered on it. */
export function CanvasDrawing() {
  return (
    <Stage
      size="mid"
      label="Tally's sign-in page the lead drew on the canvas, at version 2, split with its brand on the left, with the comment that asked for it answered"
    >
      <div className={s.under} />
      <div className={s.ghost} />
      <div className={cx(s.window, s.cv)}>
        <div className={s.bar}>
          <span className={s.glyph} />
          <b>Sign-in page</b>
          <span className={s.ver}>v2</span>
          <span className={s.btn}>Comment</span>
        </div>
        <div className={s.page}>
          <Shot w={980} h={566} label="Tally's sign-in page">
            <SignInPage />
          </Shot>
        </div>
      </div>
      <div className={s.pin}>
        <i />
        <span>
          Split it, our brand on the left.
          <em>Done in v2</em>
        </span>
      </div>
    </Stage>
  )
}

/* ---- the small ones ---- */

const WORDS = ['and', 'add', 'Google', 'sign-in', 'next', 'to', 'GitHub']

export function VoiceDrawing() {
  return (
    <Stage size="small" label="Dictating to the coordinator: the words appear as they are said, transcribed on this computer">
      <div className={s.under} />
      <span className={s.to}>To the coordinator · Tally</span>
      <div className={cx(s.card, s.composer)}>
        <span className={s.mic}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
          </svg>
        </span>
        <p className={s.words}>
          {WORDS.map((w, i) => (
            <span key={i} style={{ '--i': i } as CSSProperties}>
              {w}{' '}
            </span>
          ))}
        </p>
        <span className={s.wave}>
          {[0.4, 0.8, 0.55, 1, 0.7, 0.35, 0.9, 0.5].map((h, i) => (
            <i key={i} style={{ '--h': h, '--i': i } as CSSProperties} />
          ))}
        </span>
        <span className={s.time}>0:07</span>
      </div>
      <span className={s.local}>
        <i /> Transcribed on this computer
      </span>
    </Stage>
  )
}

const QUEUE = [
  { no: '1', repo: 'engine', pr: '#152', title: 'Add the sign-in endpoint', st: 'In the merge queue', on: true },
  { no: '2', repo: 'frontend', pr: '#127', title: 'Build the sign-in page', st: 'Merges after engine' },
  { no: '3', repo: 'docs', pr: '#131', title: 'Document signing in', st: 'Merges after frontend' },
]

export function QueueDrawing() {
  return (
    <Stage size="small" label="Three changes in merge order: engine in the merge queue, frontend and docs merging after it">
      <div className={s.under} />
      <div className={s.queue}>
        <span className={s.rail}>
          <i className={s.runner} />
        </span>
        {QUEUE.map((q) => (
          <div key={q.no} className={cx(s.card, s.stop, q.on && s.lit)}>
            <span className={s.no}>{q.no}</span>
            {mark(Brand.GitHub)}
            <span className={s.what}>
              <b>{q.title}</b>
              <small>
                {q.repo} {q.pr}
              </small>
            </span>
            <span className={cx(s.state, q.on && s.stateOn)}>{q.st}</span>
          </div>
        ))}
      </div>
    </Stage>
  )
}

const AGENTS3 = [
  { brand: Brand.ClaudeCode, name: 'Claude Code' },
  { brand: Brand.Codex, name: 'Codex' },
  { brand: Brand.OpenCode, name: 'OpenCode' },
]

/** Lines from one card at the top to three below: the hub drawings' wiring. */
function Wires() {
  return (
    <svg className={s.wires} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      {[18, 50, 82].map((x) => (
        <path key={x} d={`M50 0 C50 20 ${x} 18 ${x} 40`} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  )
}

/** `light`: on the paper's light ground, as the flow's large drawings are. */
export function SkillsDrawing({ light = false }: { light?: boolean } = {}) {
  return (
    <Stage size="small" light={light} label="One skill, release-checklist, the same version in Claude Code, Codex and OpenCode">
      <div className={s.under} />
      <div className={cx(s.card, s.hub, s.lit)}>
        <span className={s.book} />
        <span className={s.what}>
          <b>release-checklist</b>
          <small>SKILL.md · v4</small>
        </span>
      </div>
      <Wires />
      <div className={s.trio}>
        {AGENTS3.map((a) => (
          <div key={a.name} className={cx(s.card, s.agent)}>
            {mark(a.brand)}
            <b>{a.name}</b>
            <small className={s.okLine}>
              <i /> v4
            </small>
          </div>
        ))}
      </div>
    </Stage>
  )
}

const FILES = [
  { name: '~/.claude.json', line: '"linear": { … }' },
  { name: '~/.codex/config.toml', line: '[mcp_servers.linear]' },
  { name: 'opencode.json', line: '"linear": { … }' },
]

export function ServersDrawing() {
  return (
    <Stage size="small" label="The Linear MCP server, added once, written into each agent's own config file">
      <div className={s.under} />
      <div className={cx(s.card, s.hub, s.lit)}>
        {mark(Brand.Linear)}
        <span className={s.what}>
          <b>Linear</b>
          <small>MCP server · added once</small>
        </span>
      </div>
      <Wires />
      <div className={s.trio}>
        {FILES.map((f) => (
          <div key={f.name} className={cx(s.card, s.file)}>
            <code className={s.fname}>{f.name}</code>
            <i className={s.code} />
            <i className={cx(s.code, s.short)} />
            <code className={s.added}>+ {f.line}</code>
            <i className={s.code} />
          </div>
        ))}
      </div>
    </Stage>
  )
}

const TASKS = [
  { name: 'Build the sign-in page', by: Brand.ClaudeCode, cpu: 22 },
  { name: 'Sign webhook v2 payloads', by: Brand.Codex, cpu: 14 },
  { name: 'Rotate webhook secrets', by: Brand.ClaudeCode, cpu: 10 },
]

function Meter({ name, value, of, share }: { name: string; value: string; of: string; share: number }) {
  return (
    <div className={s.meter}>
      <span className={s.mName}>{name}</span>
      <span className={s.mValue}>
        <b>{value}</b> {of}
      </span>
      <span className={s.steps}>
        {Array.from({ length: 24 }, (_, i) => (
          <i key={i} className={cx(i < share * 24 * 0.62 && s.ours, i < share * 24 && s.used)} />
        ))}
      </span>
    </div>
  )
}

export function LoadDrawing() {
  return (
    <Stage size="small" label="This computer's load: CPU at 63 percent and memory at 19.5 of 32 GB, and what each task takes">
      <div className={s.under} />
      <div className={cx(s.card, s.load)}>
        <div className={s.meters}>
          <Meter name="CPU" value="63%" of="" share={0.63} />
          <Meter name="Memory" value="19.5" of="of 32 GB" share={0.61} />
        </div>
        <ol className={s.tasks}>
          {TASKS.map((t) => (
            <li key={t.name}>
              {mark(t.by)}
              <span>{t.name}</span>
              <i style={{ '--w': `${t.cpu * 3}%` } as CSSProperties} />
              <b>{t.cpu}%</b>
            </li>
          ))}
        </ol>
      </div>
    </Stage>
  )
}

const FOLDERS = [
  { name: 'Sign webhook v2 payloads', why: 'merged', size: '2.4 GB' },
  { name: 'Audit third-party scripts', why: 'done', size: '2.1 GB' },
  { name: 'Document the retry contract', why: 'not pushed · kept', size: '2.3 GB', kept: true },
]

export function StorageDrawing() {
  return (
    <Stage size="small" label="Task folders: 9.5 GB can go now, 7 GB held back because it is not pushed yet">
      <div className={s.under} />
      <div className={cx(s.card, s.disk)}>
        <div className={s.diskHead}>
          <b>Task folders</b>
          <span className={s.kind}>Smart</span>
          <span className={s.clean}>Clean up</span>
        </div>
        <span className={s.diskBar}>
          <i className={s.dUsed} />
          <i className={s.dHeld} />
          <i className={s.dGo} />
        </span>
        <span className={s.legend}>
          <span>
            <i className={s.dGo} /> Can go <b>9.5 GB</b>
          </span>
          <span>
            <i className={s.dHeld} /> Held back <b>7.0 GB</b>
          </span>
        </span>
        <ol className={s.folders}>
          {FOLDERS.map((f) => (
            <li key={f.name} className={cx(f.kept ? s.kept : s.going)}>
              <span>{f.name}</span>
              <small>{f.why}</small>
              <b>{f.size}</b>
            </li>
          ))}
        </ol>
      </div>
    </Stage>
  )
}
