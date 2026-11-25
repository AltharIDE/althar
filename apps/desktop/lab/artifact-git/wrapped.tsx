import {
  ArtifactHead as KitArtifactHead,
  type ArtifactHeadProps,
  Button,
  CanvasPanel as KitCanvasPanel,
  type CanvasPanelProps,
  Diff,
  type DiffLine,
  DiffLineKind,
  LinkButton,
  Segmented,
} from '@althar/ui'
import { type ReactNode, type Ref, useLayoutEffect, useRef, useState } from 'react'

import panel from '../../../../packages/ui/src/thread/Canvas/Canvas.module.css'
import { byWords, shownOf, type Variant, versionOf } from './data'
import { type LabState, lab, PEOPLE, type Person, useLab, whoOf } from './state'
import w from './wrapped.module.css'

/*
 * The kit's own components as the lab hands them to the artifact's room,
 * each wrapped so a direction can say what came from git: the artifact's row
 * says who made the version shown; the canvas panel's line over the canvas
 * says someone changed it, with what to do; and the canvas itself, which the
 * main process draws in a view of its own in the app, is the design's page
 * here, as a board on the canvas's ground, or (B) yours and theirs side by
 * side with what differs pinned.
 */

/** A person, as a face: their initial on their ink. */
export function Face({ who, you = false }: { who: Person; you?: boolean }) {
  const person = PEOPLE[who]
  return (
    <span className={w.face} data-ink={person.ink} title={you ? `${person.name} (you)` : person.name} aria-hidden="true">
      {person.name.charAt(0)}
    </span>
  )
}

/* ---- The artifact's row: who made the version shown ------------------- */

export function ArtifactHead(props: ArtifactHeadProps) {
  const s = useLab()
  return <KitArtifactHead {...props} by={byWords(s, versionOf(s, shownOf(s)))} />
}

/* ---- The canvas panel: the line over the canvas ----------------------- */

const other = (s: LabState): Person => (whoOf(s) === 'ana' ? 'maya' : 'ana')

/** A line over the canvas, as the panel's own "v5 is out" is drawn: what happened, then what to do about it. */
function Line({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={panel.facts} data-lab-line="">
      <span className={w.said}>{children}</span>
      {actions !== undefined && <span className={panel.behind}>{actions}</span>}
    </div>
  )
}

/** What the line over the canvas says, in this direction and moment, for the version shown; null for nothing. */
const lineOf = (s: LabState, shown: number): ReactNode => {
  const them = PEOPLE[other(s)].name
  const ana = whoOf(s) === 'ana'
  switch (s.d) {
    case 'a': {
      if (ana)
        return shown === 5 ? (
          <Line>
            <Face who="maya" /> v5 is Maya’s, on your v4. She kept Gift this class.
          </Line>
        ) : null
      if (s.m === 0)
        return shown === 5 ? (
          <Line actions={<LinkButton onClick={() => lab.set({ m: 1 })}>Bring it in</LinkButton>}>
            <Face who="ana" /> v5 is Ana’s, on v3: your v4 isn’t in it.
          </Line>
        ) : null
      if (shown === 6)
        return (
          <Line actions={s.takenOut ? undefined : <LinkButton onClick={() => lab.set({ takenOut: true })}>Take it out</LinkButton>}>
            v6 brings in Ana’s v5. She’d taken out Gift this class; it’s kept here.
          </Line>
        )
      return null
    }
    case 'b':
      if (s.compare === true || (s.compare === null && (s.m === 1 || ana))) return null
      if (s.m >= 2) return null
      return (
        <Line actions={<LinkButton onClick={() => lab.set(ana ? { compare: true } : { m: 1 })}>Compare</LinkButton>}>
          <Face who={other(s)} /> {ana ? 'Maya changed it in #221 · 2 min ago' : `${them} changed it in git · 25 min ago`}
        </Line>
      )
    case 'c':
      return null
    case 'd':
      // Ana's own: the draft's chip says it's in review, and her chat has Maya's ask from GitHub.
      if (ana) return null
      if (s.m === 0)
        return (
          <Line>
            <Face who="ana" /> Ana’s draft, #221, is open on it. What you change goes in it too.
          </Line>
        )
      return null
  }
}

export function CanvasPanel(props: CanvasPanelProps) {
  const s = useLab()
  const them = PEOPLE[other(s)].name
  const line = lineOf(s, props.version)
  return (
    <KitCanvasPanel
      {...props}
      // A version from someone else is said for what it is, where the panel says a newer one is out.
      text={s.d === 'a' ? { newerOut: (n) => `${them} changed it in git: v${n}` } : {}}
    >
      {line}
      {props.children}
    </KitCanvasPanel>
  )
}

/* ---- The canvas: the design's page, as a board ------------------------ */

const PAGE = { width: 1000, height: 680 } as const

/** The design's page at a version, drawn at its own size and scaled to fit its place, with the parts asked pinned. */
function Board({ variant, pins = '', fit = 'both' }: { variant: Variant; pins?: string; fit?: 'both' | 'width' }) {
  const place = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  useLayoutEffect(() => {
    const element = place.current
    if (element === null) return
    const measure = () => {
      const box = element.getBoundingClientRect()
      const across = box.width / PAGE.width
      setScale(fit === 'width' ? across : Math.min(across, box.height / PAGE.height))
    }
    measure()
    const watching = new ResizeObserver(measure)
    watching.observe(element)
    return () => watching.disconnect()
  }, [fit])
  // Pins are Althar's, drawn over the board at their own size whatever its scale, as the ground draws them.
  const frame = useRef<HTMLIFrameElement>(null)
  const pinScale = () => frame.current?.contentDocument?.documentElement.style.setProperty('--pin-scale', String(1 / scale))
  useLayoutEffect(pinScale)
  return (
    <div ref={place} className={w.boardPlace}>
      <div className={w.board} style={{ width: PAGE.width * scale, height: PAGE.height * scale }}>
        <iframe
          ref={frame}
          title={`Booking page · ${variant}`}
          src={`./design.html?v=${variant}${pins === '' ? '' : `&pins=${pins}`}`}
          style={{ width: PAGE.width, height: PAGE.height, transform: `scale(${scale})` }}
          tabIndex={-1}
          onLoad={pinScale}
        />
      </div>
    </div>
  )
}

export function CanvasPagePlace({ ref, canvas, children }: { ref?: Ref<HTMLDivElement>; canvas: string; children?: ReactNode }) {
  const s = useLab()
  const comparing = s.d === 'b' && (s.compare ?? (s.m === 1 || whoOf(s) === 'ana'))
  const variant = versionOf(s, shownOf(s))?.variant ?? 'base'
  return (
    <div ref={ref} className={panel.page} data-canvas-page={canvas}>
      <div className={w.ground}>{comparing ? <Compare /> : <Board variant={variant} />}</div>
      {children}
    </div>
  )
}

/* ---- B: side by side -------------------------------------------------- */

interface Difference {
  readonly n: number
  readonly part: string
  readonly what: string
  readonly words: string
  readonly call?: boolean
}

const MAYA_DIFFERENCES: ReadonlyArray<Difference> = [
  { n: 1, part: 'when', what: 'When and places left', words: 'Ana’s, from the bookings API' },
  { n: 2, part: 'book', what: 'Price and Book', words: 'Ana’s price, in your Book bar' },
  { n: 3, part: 'gift', what: 'Gift this class', words: 'Ana took it out; you made it a button', call: true },
]

const ANA_DIFFERENCES: ReadonlyArray<Difference> = [
  { n: 1, part: 'heading', what: 'Heading', words: 'Maya’s' },
  { n: 2, part: 'book', what: 'Price and Book', words: 'Your price, in her Book bar' },
  { n: 3, part: 'gift', what: 'Gift this class', words: 'You took it out; she kept it, as a button' },
]

const pinsOf = (differences: ReadonlyArray<Difference>) => differences.map((one) => `${one.part}:${one.n}`).join(',')

/** Yours, theirs, and (for the one who has both to bring together) the two together, with what differs pinned and listed. */
function Compare() {
  const s = useLab()
  const ana = whoOf(s) === 'ana'
  const files = s.files ?? ana
  const gift = s.gift ?? 'keep'
  const differences = ana ? ANA_DIFFERENCES : MAYA_DIFFERENCES
  const boards: ReadonlyArray<{ readonly label: string; readonly who: Person | null; readonly variant: Variant; readonly pins?: string }> =
    ana
      ? [
          { label: 'Yours · v4', who: null, variant: 'ana' },
          { label: 'Maya’s · in #221', who: 'maya', variant: 'together', pins: pinsOf(differences) },
        ]
      : [
          { label: 'Yours · v4', who: null, variant: 'maya' },
          { label: 'Ana’s · in #221', who: 'ana', variant: 'ana' },
          { label: 'Together', who: null, variant: gift === 'out' ? 'together-nogift' : 'together', pins: pinsOf(differences) },
        ]
  return (
    <div className={w.compare}>
      <div className={w.compareHead}>
        <Segmented
          label="Compare"
          value={files ? 'files' : 'boards'}
          onChange={(value) => lab.set({ files: value === 'files' })}
          options={[
            { value: 'boards', label: 'Boards' },
            { value: 'files', label: 'Files' },
          ]}
        />
        <span className={w.said}>
          <Face who={ana ? 'maya' : 'ana'} />
          {ana ? 'Maya changed it in #221 · 2 min ago' : 'Ana changed it in #221 · 25 min ago'}
        </span>
        <span className={w.gap} />
        <Button size="small" variant="quiet" onClick={() => lab.set({ compare: false })}>
          Close
        </Button>
      </div>
      {files ? (
        <div className={w.files}>
          <Diff lines={ana ? FROM_MAYA : FROM_ANA} path="design/booking/index.html" label="design/booking/index.html" />
        </div>
      ) : (
        <div className={w.boards} data-count={boards.length}>
          {boards.map((board) => (
            <figure key={board.label} className={w.figure}>
              <figcaption className={w.caption}>
                {board.who !== null && <Face who={board.who} />}
                {board.label}
              </figcaption>
              <Board variant={board.variant} {...(board.pins === undefined ? {} : { pins: board.pins })} fit="width" />
            </figure>
          ))}
        </div>
      )}
      <div className={w.differences}>
        <ol className={w.list}>
          {differences.map((one) => (
            <li key={one.n} className={w.difference}>
              <span className={w.pin}>{one.n}</span>
              <span className={w.what}>{one.what}</span>
              <span className={w.words}>{one.words}</span>
              {one.call === true && (
                <Segmented
                  label={one.what}
                  value={gift}
                  onChange={(value) => lab.set({ gift: value })}
                  options={[
                    { value: 'keep', label: 'Keep it' },
                    { value: 'out', label: 'Take it out' },
                  ]}
                />
              )}
            </li>
          ))}
        </ol>
        <div className={w.decide}>
          <Button size="small" variant="quiet" onClick={() => lab.set({ compare: false })}>
            Keep mine
          </Button>
          {ana ? (
            <Button size="small" variant="signal" onClick={() => lab.set({ compare: false, shown: null })}>
              Take Maya’s
            </Button>
          ) : (
            <>
              <Button size="small" variant="quiet" onClick={() => lab.set({ m: 2, took: 'theirs' })}>
                Take Ana’s
              </Button>
              <Button size="small" variant="signal" onClick={() => lab.set({ m: 2, gift, took: 'together' })}>
                Use together
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** A diff's lines, from a short listing: `+` added, `-` removed, anything else unchanged. */
const linesOf = (listing: string, from = 31): ReadonlyArray<DiffLine> => {
  let old = from
  let now = from
  const lines: Array<DiffLine> = [{ kind: DiffLineKind.Hunk, text: `@@ -${from} +${from} @@` }]
  for (const row of listing.split('\n')) {
    const text = row.slice(2)
    if (row.startsWith('+ ')) lines.push({ kind: DiffLineKind.Added, new: now++, text })
    else if (row.startsWith('- ')) lines.push({ kind: DiffLineKind.Removed, old: old++, text })
    else lines.push({ kind: DiffLineKind.Context, old: old++, new: now++, text })
  }
  return lines
}

/** What Ana's commit in #221 changed, for Maya. */
const FROM_ANA = linesOf(`  <section class="info">
    <h1 data-part="heading">Wheel throwing for beginners</h1>
-   <p class="when">Saturday mornings</p>
+   <p class="when">{{ class.next | date: "ddd d MMM · HH:mm" }}–{{ class.ends | time }}</p>
+   <p class="left">{{ class.placesLeft }} places left</p>
-   <p class="price">£45 <small>a place</small></p>
+   <p class="price">{{ class.price | money }} <small>a place</small></p>
    <div class="actions">
      <button class="book">Book a place</button>
-     <a class="gift" href="/gift">Gift this class</a>
    </div>
  </section>`)

/** What Maya's commit in #221 changed, for Ana: on hers. */
const FROM_MAYA = linesOf(`  <section class="info">
-   <h1 data-part="heading">Wheel throwing for beginners</h1>
+   <h1 data-part="heading">Book a wheel-throwing class</h1>
    <p class="when">{{ class.next | date: "ddd d MMM · HH:mm" }}–{{ class.ends | time }}</p>
    <p class="left">{{ class.placesLeft }} places left</p>
-   <p class="price">{{ class.price | money }} <small>a place</small></p>
-   <div class="actions">
+   <div class="bar">
+     <p class="price">{{ class.price | money }} <small>a place</small></p>
      <button class="book">Book a place</button>
    </div>
+   <button class="gift" data-href="/gift">Gift this class</button>
  </section>`)
