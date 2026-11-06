// Scrappy: C's Compare face: the same page on main's run and on the task's, side by side, swiped or laid one over the other,
// scrolled together; comments only on the task's side; the lead's screenshots, taken in this same browser, laid over the live page.
import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'

import { Icon } from '../../../src/foundations/Icon/Icon'
import { cx } from '../../../src/lib/cx'
import { IconButton } from '../../../src/primitives/IconButton/IconButton'
import { Segmented } from '../../../src/primitives/Segmented/Segmented'
import { onRun, RUNS, shown, verdictOf } from '../addresses'
import { EVIDENCE } from '../data'
import { addressOf, type Mode, proto, TASK, useProto } from '../state'
import { Bar, Line } from './Bar'
import s from './Compare.module.css'
import { Frame, type Place } from './Frame'
import { cropSrc, Gathered } from './Gathered'
import { followInRun, WidthSwitch } from './Preview'
import screens from './Screens.module.css'
import { NotRunning } from './Stand'

const WIDE = 1280
const PHONE = 390

function ModeSwitch() {
  const p = useProto()
  return (
    <Segmented<Mode>
      label="Compare"
      value={p.mode}
      onChange={(mode) => proto.set({ mode, evidence: null })}
      options={[
        { value: 'side', label: 'Side by side' },
        { value: 'swipe', label: 'Swipe' },
        { value: 'onion', label: 'Onion skin' },
      ]}
    />
  )
}

/** Which run a side is, at a glance: main, or this task with its branch. */
function Side({ run, className, changes, onNext }: { run: 'main' | 'task'; className?: string; changes?: number; onNext?: () => void }) {
  return (
    <span className={cx(s.side, className)}>
      <span className={s.dot} data-run={run} />
      <span className={s.sideName}>{run === 'main' ? 'main' : 'This task'}</span>
      {run === 'task' && <code className={s.branch}>{TASK.branch}</code>}
      <code className={s.port}>{shown(RUNS[run].address)}</code>
      {changes !== undefined && changes > 0 && (
        <button type="button" className={s.count} onClick={onNext} title="The next change">
          {changes === 1 ? '1 change' : `${changes} changes`}
          <Icon name="chevronD" size={11} />
        </button>
      )}
    </span>
  )
}

/** What the task's page says that main's doesn't: each piece of text main hasn't anywhere, by the element that holds it. */
const changedIn = (task: Document, main: Document): Element[] => {
  const texts = (doc: Document) => {
    const found: Array<{ text: string; el: Element }> = []
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
      const el = node.parentElement
      if (text === '' || el === null || el.closest('script, style, noscript, [aria-hidden="true"]') !== null) continue
      found.push({ text, el })
    }
    return found
  }
  const known = new Set(texts(main).map((one) => one.text))
  return [
    ...new Set(
      texts(task)
        .filter((one) => !known.has(one.text))
        .map((one) => one.el),
    ),
  ].filter((el) => el.getBoundingClientRect().width > 0)
}

/** The changes, marked on the task's side. */
function Changed({ place, changes }: { place: Place; changes: ReadonlyArray<Element> }) {
  return (
    <>
      {changes.map((el, at) => {
        const rect = el.getBoundingClientRect()
        return (
          <span
            key={at}
            className={s.changed}
            style={{
              left: place.left + rect.left * place.scale - 3,
              top: rect.top * place.scale - 2,
              width: rect.width * place.scale + 6,
              height: rect.height * place.scale + 4,
            }}
          />
        )
      })}
    </>
  )
}

/** The lead's screenshot laid over the live page, where it was taken. */
function Laid({ place, digest, opacity }: { place: Place; digest: string; opacity: number }) {
  const shot = EVIDENCE.find((one) => one.digest === digest)
  if (shot === undefined) return null
  return (
    <img
      className={s.laid}
      src={cropSrc(shot.digest)}
      alt=""
      style={{
        left: place.left + shot.box.x * place.scale,
        top: (shot.box.y - place.scrollY) * place.scale,
        width: shot.box.w * place.scale,
        height: shot.box.h * place.scale,
        opacity,
      }}
    />
  )
}

export function Compare() {
  const p = useProto()
  const page = p.preview
  const address = addressOf(page)
  const verdict = verdictOf(address)
  const [y, setY] = useState<number | null>(null)
  const [docs, setDocs] = useState<{ task: Document | null; main: Document | null }>({ task: null, main: null })
  const [at, setAt] = useState(-1)
  const changes =
    docs.task !== null && docs.main !== null && docs.task.defaultView !== null && docs.main.defaultView !== null
      ? changedIn(docs.task, docs.main)
      : []
  const next = () => {
    if (changes.length === 0) return
    const n = (at + 1) % changes.length
    setAt(n)
    changes[n]?.scrollIntoView({ block: 'center' })
  }
  const body = useRef<HTMLDivElement>(null)
  const shot = EVIDENCE.find((one) => one.digest === p.evidence) ?? null
  const width = shot !== null ? (shot.viewport.w === PHONE ? PHONE : null) : p.width === 'narrow' ? PHONE : null
  const mainAddress = onRun(address, 'main')
  const mainVerdict = verdictOf(mainAddress)
  const scroll = { scrollY: y, onScroll: setY }

  const drag = (event: ReactPointerEvent) => {
    const rect = body.current?.getBoundingClientRect()
    if (rect === undefined) return
    const move = (clientX: number) => proto.set({ swipe: Math.min(0.98, Math.max(0.02, (clientX - rect.left) / rect.width)) })
    move(event.clientX)
    const onMove = (next: PointerEvent) => move(next.clientX)
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // A screenshot opened: the page scrolled where the lead took it.
  useEffect(() => {
    if (shot !== null) setY(shot.scroll)
  }, [shot])

  const task = (
    extra: {
      className?: string
      pageStyle?: object
      pageWidth?: number | null
      pageHeight?: number | null
      layer?: (place: Place) => React.ReactNode
    } = {},
  ) =>
    verdict.kind === 'page' ? (
      <Frame
        scope="preview"
        address={address}
        src={verdict.src}
        reloads={page.reloads}
        onFollow={followInRun}
        pageWidth={width}
        onDoc={(doc) => setDocs((was) => (was.task === doc ? was : { ...was, task: doc }))}
        layer={(place) => <Changed place={place} changes={changes} />}
        {...scroll}
        {...extra}
      />
    ) : null
  const main = (extra: { className?: string; pageWidth?: number | null } = {}) =>
    mainVerdict.kind === 'page' ? (
      <Frame
        scope="main"
        address={mainAddress}
        src={mainVerdict.src}
        reloads={page.reloads}
        onFollow={followInRun}
        pointable={false}
        pageWidth={width}
        onDoc={(doc) => setDocs((was) => (was.main === doc ? was : { ...was, main: doc }))}
        {...scroll}
        {...extra}
      />
    ) : null

  return (
    <div className={screens.face}>
      <Bar
        scope="preview"
        page={page}
        host={shown(RUNS.task.address)}
        session="task"
        extra={
          <>
            <ModeSwitch />
            <WidthSwitch />
          </>
        }
        pointable={p.running === 'up'}
      />
      <Line scope="preview" />
      {p.running !== 'up' ? (
        <NotRunning starting={p.running === 'starting'} />
      ) : shot !== null ? (
        <>
          <div className={s.labels}>
            <span className={s.side}>
              <Icon name="image" size={13} />
              <span className={s.sideName}>{shot.caption}</span>
            </span>
            <span className={s.grow} />
            <span className={s.fade}>
              <span>Screenshot</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={1 - p.onion}
                aria-label="Screenshot over the live page"
                onChange={(event) => proto.set({ onion: 1 - Number(event.target.value) })}
              />
              <span>Live</span>
            </span>
            <IconButton icon="close" label="Back to comparing" size="small" onClick={() => proto.set({ evidence: null })} />
          </div>
          <div className={s.body}>
            {task({
              pageWidth: shot.viewport.w,
              pageHeight: shot.viewport.h,
              layer: (place) => <Laid place={place} digest={shot.digest} opacity={1 - p.onion} />,
            })}
          </div>
        </>
      ) : (
        <>
          <div className={s.labels}>
            {p.mode === 'side' ? (
              <>
                <Side run="main" className={s.half} />
                <Side run="task" className={s.half} changes={changes.length} onNext={next} />
              </>
            ) : p.mode === 'swipe' ? (
              <>
                <Side run="main" />
                <span className={s.grow} />
                <Side run="task" changes={changes.length} onNext={next} />
              </>
            ) : (
              <>
                <Side run="main" />
                <span className={s.grow} />
                <input
                  className={s.onion}
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={p.onion}
                  aria-label="Main or this task"
                  onChange={(event) => proto.set({ onion: Number(event.target.value) })}
                />
                <span className={s.grow} />
                <Side run="task" changes={changes.length} onNext={next} />
              </>
            )}
          </div>
          <div ref={body} className={cx(s.body, p.mode === 'side' && s.split)}>
            {p.mode === 'side' ? (
              <>
                {main({ pageWidth: width ?? WIDE })}
                {task({ pageWidth: width ?? WIDE })}
              </>
            ) : p.mode === 'swipe' ? (
              <>
                {main({ className: s.under })}
                {task({ className: s.over, pageStyle: { clipPath: `inset(0 0 0 ${p.swipe * 100}%)` } })}
                <div
                  className={s.handle}
                  style={{ left: `${p.swipe * 100}%` }}
                  onPointerDown={drag}
                  role="slider"
                  aria-label="Main or this task"
                  aria-valuenow={Math.round(p.swipe * 100)}
                  tabIndex={0}
                >
                  <span className={s.grip}>
                    <Icon name="chevronL" size={11} />
                    <Icon name="chevron" size={11} />
                  </span>
                </div>
              </>
            ) : (
              <>
                {main({ className: s.under })}
                {task({ className: s.over, pageStyle: { opacity: p.onion } })}
              </>
            )}
          </div>
        </>
      )}
      {p.comments.some((one) => one.scope === 'preview') || p.lines.preview?.kind === 'sent' ? (
        <Gathered
          scope="preview"
          to={{ kind: 'task', taskId: TASK.id }}
          openLabel="Conversation"
          onOpenSent={() => proto.set({ face: false })}
        />
      ) : (
        <Evidence />
      )}
    </div>
  )
}

/** The lead's screenshots, taken in this task's browser: each opens laid over the live page, where it was taken. */
function Evidence() {
  const p = useProto()
  return (
    <div className={s.evidence}>
      <span className={s.evidenceHead}>Taken here by {TASK.lead}</span>
      <ul className={s.shots}>
        {EVIDENCE.map((one) => (
          <li key={one.digest}>
            <button
              type="button"
              className={cx(s.shot, p.evidence === one.digest && s.on)}
              title="Lay it over the live page"
              onClick={() => proto.set({ evidence: p.evidence === one.digest ? null : one.digest, onion: 0.5 })}
            >
              <img src={cropSrc(one.digest)} alt="" />
              <span>{one.view}</span>
              <span className={s.at}>{one.viewport.w === PHONE ? 'Phone' : 'Desktop'} · 9m ago</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
