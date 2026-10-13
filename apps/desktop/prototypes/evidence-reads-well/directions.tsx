import { useState } from 'react'

import {
  type EvidencePiece,
  EvidenceKind,
  Icon,
  type IconName,
  ImageView,
  LinkButton,
  Segmented,
  Terminal,
  useThreadShell,
} from '../../../../packages/ui/src/index'
import { useScenario } from './direction'
import type { DirectionProps } from './Evidence'
import s from './directions.module.css'
import {
  Built,
  Gallery,
  imagesOf,
  isOutput,
  isPicture,
  Label,
  NoteLine,
  NothingShown,
  type Output,
  outcomeOf,
  type Picture,
  placeOf,
  Receipt,
  Receipts,
  Shot,
  ToCheck,
  useGroups,
} from './parts'

/* The five directions, each in both places: under a step in the thread, and on Outputs under what was built. */

const iconOf: Record<EvidenceKind, IconName> = {
  [EvidenceKind.Screenshot]: 'image',
  [EvidenceKind.Recording]: 'play',
  [EvidenceKind.Command]: 'terminal',
  [EvidenceKind.TestRun]: 'list',
  [EvidenceKind.Response]: 'file',
  [EvidenceKind.Log]: 'file',
  [EvidenceKind.Note]: 'quote',
}

const kindWord: Record<EvidenceKind, string> = {
  [EvidenceKind.Screenshot]: 'Screenshot',
  [EvidenceKind.Recording]: 'Recording',
  [EvidenceKind.Command]: 'Command',
  [EvidenceKind.TestRun]: 'Tests',
  [EvidenceKind.Response]: 'Response',
  [EvidenceKind.Log]: 'Log',
  [EvidenceKind.Note]: 'Note',
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const notes = (pieces: readonly EvidencePiece[]) =>
  pieces.flatMap((one) => (one.form === 'note' ? [<NoteLine key={one.id} piece={one} />] : []))

/* ---------- A · a proof checklist ---------- */

type Row = { readonly key: string; readonly text: string; readonly proof: readonly EvidencePiece[] }

function Proof({ row, pictures }: { row: Row; pictures: readonly Picture[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const runs = row.proof.filter(isOutput)
  const failed = runs.some((one) => !outcomeOf(one).ok)
  const none = row.proof.length === 0
  const shown = open === null ? undefined : runs.find((one) => one.id === open)
  return (
    <li className={s.proofRow}>
      <span className={[s.mark, none ? s.none : failed ? s.bad : s.ok].join(' ')} aria-hidden="true">
        {!none && <Icon name={failed ? 'close' : 'check'} size={10} />}
      </span>
      <div className={s.proofBody}>
        <span className={s.claim}>{row.text}</span>
        <span className={s.proofs}>
          {none && <span className={s.tag}>No proof given</span>}
          {row.proof.map((one) =>
            isPicture(one) ? (
              <Shot key={one.id} picture={one} set={pictures} size="chip" caption={false} />
            ) : isOutput(one) ? (
              <button
                key={one.id}
                type="button"
                className={[s.chip, !outcomeOf(one).ok && s.chipBad].filter(Boolean).join(' ')}
                aria-expanded={open === one.id}
                onClick={() => setOpen(open === one.id ? null : one.id)}
              >
                <Icon name={iconOf[one.kind]} size={12} />
                <span>{kindWord[one.kind]}</span>
                <span className={s.dim}>{outcomeOf(one).words}</span>
              </button>
            ) : (
              <span key={one.id} className={s.chip}>
                <Icon name="quote" size={12} />
                {one.caption}
              </span>
            ),
          )}
        </span>
        {shown !== undefined && (
          <div className={s.printed}>
            <Terminal
              lines={shown.lines}
              {...(shown.command === undefined ? {} : { command: shown.command })}
              {...(shown.exit === undefined ? {} : { exit: shown.exit })}
            />
          </div>
        )}
      </div>
    </li>
  )
}

export function A({ pieces, unverified, face }: DirectionProps) {
  const scenario = useScenario()
  const pictures = pieces.filter(isPicture)
  const byPlace = new Map(pieces.map((one) => [placeOf(one), one]))
  const claimed = new Set(scenario.claims.flatMap((claim) => claim.proof))
  const rows: Row[] =
    face === 'out'
      ? [
          ...scenario.claims.map((claim) => ({
            key: claim.text,
            text: claim.text,
            proof: claim.proof.flatMap((place) => byPlace.get(place) ?? []),
          })),
          // Anything shown that no claim names, as its own line.
          ...pieces.filter((one) => !claimed.has(placeOf(one))).map((one) => ({ key: one.id, text: one.caption, proof: [one] })),
        ]
      : pieces.map((one) => ({ key: one.id, text: one.caption, proof: [one] }))
  const proven = rows.filter((row) => row.proof.length > 0).length
  const level = face === 'out' ? 2 : 4
  if (face === 'thread' && rows.length === 0 && unverified.length === 0) return <NothingShown>Nothing shown for this step</NothingShown>
  return (
    <div className={s.stack}>
      {face === 'out' && <Built source={scenario.built} />}
      <Label level={level}>
        {face === 'out' ? `Proof · ${proven} of ${rows.length} shown` : `Shown · ${rows.length}`}
        {unverified.length > 0 && ` · ${unverified.length} yours to check`}
      </Label>
      <ul className={s.proofList}>
        {rows.map((row) => (
          <Proof key={row.key} row={row} pictures={pictures} />
        ))}
        {unverified.map((line) => (
          <li key={line} className={s.proofRow}>
            <span className={[s.mark, s.open].join(' ')} aria-hidden="true" />
            <div className={s.proofBody}>
              <span className={s.claim}>{line}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---------- B · a gallery first ---------- */

function Groups({ pictures, compact }: { pictures: readonly Picture[]; compact: boolean }) {
  const scenario = useScenario()
  const groups = useGroups(pictures, scenario.groups)
  const ordered = groups.flatMap((group) => group.pictures)
  // Each group's first number, counting on from the groups before it.
  const starts = groups.map((_, i) => 1 + groups.slice(0, i).reduce((sum, group) => sum + group.pictures.length, 0))
  if (compact) return <Gallery pictures={ordered} columns={4} />
  return (
    <div className={s.groups}>
      {groups.map((group, i) => {
        const start = starts[i] ?? 1
        return (
          <section key={group.title} className={s.group}>
            {group.title !== '' && <h3 className={s.groupTitle}>{group.title}</h3>}
            <Gallery pictures={group.pictures} set={ordered} start={start} />
          </section>
        )
      })}
    </div>
  )
}

function GalleryFirst({ pieces, unverified, face }: DirectionProps) {
  const pictures = pieces.filter(isPicture)
  const outputs = pieces.filter(isOutput)
  const level = face === 'out' ? 2 : 4
  return (
    <>
      {pictures.length > 0 && (
        <section className={s.stack}>
          <Label level={level}>Screenshots · {pictures.length}</Label>
          <Groups pictures={pictures} compact={face === 'thread'} />
        </section>
      )}
      {notes(pieces)}
      <Receipts outputs={outputs} level={level} title={pictures.length > 0 ? 'Receipts' : 'What ran'} />
      <ToCheck lines={unverified} level={level} />
    </>
  )
}

export function B(props: DirectionProps) {
  const scenario = useScenario()
  if (props.pieces.length === 0 && props.unverified.length === 0)
    return props.face === 'out' ? (
      <div className={s.stack}>
        <Built source={scenario.built} />
        <NothingShown>The lead showed nothing of it working, and named nothing for you to check.</NothingShown>
      </div>
    ) : (
      <NothingShown>Nothing shown for this step</NothingShown>
    )
  return (
    <div className={s.stack}>
      {props.face === 'out' && <Built source={scenario.built} />}
      <GalleryFirst {...props} />
    </div>
  )
}

/* ---------- C · before and after ---------- */

function PicturePair({
  before,
  after,
  of,
  compact,
  set,
}: {
  before: Picture
  after: Picture
  of: string
  compact: boolean
  set: readonly Picture[]
}) {
  const [mode, setMode] = useState<'side' | 'slider'>('side')
  const [at, setAt] = useState(50)
  const { openImage } = useThreadShell()
  const ratio = `${after.shot.width ?? 16} / ${after.shot.height ?? 10}`
  return (
    <figure className={s.pair}>
      <figcaption className={s.pairHead}>
        <span className={s.pairOf}>{of}</span>
        {!compact && (
          <Segmented
            label="Show the pair"
            options={[
              { value: 'side', label: 'Side by side' },
              { value: 'slider', label: 'Slider' },
            ]}
            value={mode}
            onChange={setMode}
          />
        )}
      </figcaption>
      {mode === 'side' || compact ? (
        <div className={s.sides}>
          {[
            ['Before', before],
            ['After', after],
          ].map(([word, one]) => (
            <div key={word as string} className={s.side}>
              <span className={[s.sideWord, word === 'After' && s.after].filter(Boolean).join(' ')}>{word as string}</span>
              <Shot picture={one as Picture} set={set} size={compact ? 'thumb' : 'full'} />
            </div>
          ))}
        </div>
      ) : (
        <div className={s.slider} style={{ aspectRatio: ratio }}>
          <button type="button" className={s.layer} onClick={() => openImage?.(imagesOf([after])[0] ?? after.shot, imagesOf(set))}>
            <ImageView image={after.shot} fit="cover" />
          </button>
          <div className={s.layer} style={{ clipPath: `inset(0 ${100 - at}% 0 0)` }}>
            <ImageView image={before.shot} fit="cover" />
          </div>
          <span className={s.handle} style={{ left: `${at}%` }} />
          <span className={[s.sideWord, s.onLeft].join(' ')}>Before</span>
          <span className={[s.sideWord, s.after, s.onRight].join(' ')}>After</span>
          <input
            className={s.range}
            type="range"
            min={0}
            max={100}
            value={at}
            aria-label="Drag between before and after"
            onChange={(event) => setAt(Number(event.target.value))}
          />
        </div>
      )}
      <div className={s.pairCaptions}>
        <span>{before.caption}</span>
        <span>{after.caption}</span>
      </div>
    </figure>
  )
}

function RunPair({ before, after, of }: { before: Output; after: Output; of: string }) {
  return (
    <figure className={s.pair}>
      <figcaption className={s.pairHead}>
        <span className={s.pairOf}>{of}</span>
      </figcaption>
      <div className={s.sides}>
        {[
          ['Before', before],
          ['After', after],
        ].map(([word, one]) => {
          const run = one as Output
          const { ok, words } = outcomeOf(run)
          return (
            <div key={word as string} className={s.side}>
              <span className={[s.sideWord, word === 'After' && s.after].filter(Boolean).join(' ')}>
                {word as string} · <span className={ok ? s.okText : s.badText}>{words}</span>
              </span>
              <p className={s.runCaption}>{run.caption}</p>
              <Terminal
                lines={run.lines}
                {...(run.command === undefined ? {} : { command: run.command })}
                {...(run.exit === undefined ? {} : { exit: run.exit })}
              />
            </div>
          )
        })}
      </div>
    </figure>
  )
}

export function C({ pieces, unverified, face }: DirectionProps) {
  const scenario = useScenario()
  const byPlace = new Map(pieces.map((one) => [placeOf(one), one]))
  const pictures = pieces.filter(isPicture)
  const paired = new Set(scenario.pairs.flatMap((pair) => [pair.before, pair.after]))
  const rest = pieces.filter((one) => !paired.has(placeOf(one)))
  const level = face === 'out' ? 2 : 4
  const compact = face === 'thread'
  if (pieces.length === 0 && unverified.length === 0) return <B pieces={pieces} unverified={unverified} face={face} />
  return (
    <div className={s.stack}>
      {face === 'out' && <Built source={scenario.built} />}
      {scenario.pairs.length > 0 && (
        <section className={s.stack}>
          <Label level={level}>Before and after · {scenario.pairs.length}</Label>
          {scenario.pairs.map((pair) => {
            const before = byPlace.get(pair.before)
            const after = byPlace.get(pair.after)
            if (before === undefined || after === undefined) return null
            if (isPicture(before) && isPicture(after))
              return <PicturePair key={pair.of} before={before} after={after} of={pair.of} compact={compact} set={pictures} />
            if (isOutput(before) && isOutput(after))
              return compact ? (
                <div key={pair.of} className={s.runPairLine}>
                  <span className={s.pairOf}>{pair.of}</span>
                  <span className={s.badText}>before: {outcomeOf(before).words}</span>
                  <Icon name="arrow" size={12} />
                  <span className={s.okText}>after: {outcomeOf(after).words}</span>
                </div>
              ) : (
                <RunPair key={pair.of} before={before} after={after} of={pair.of} />
              )
            return null
          })}
        </section>
      )}
      <GalleryFirst pieces={rest} unverified={unverified} face={face} />
    </div>
  )
}

/* ---------- D · one line under a step ---------- */

const opened = typeof location !== 'undefined' && new URLSearchParams(location.search).has('open')

export function D({ pieces, unverified, face }: DirectionProps) {
  const [open, setOpen] = useState(opened)
  const pictures = pieces.filter(isPicture)
  const outputs = pieces.filter(isOutput)
  const failed = outputs.filter((one) => !outcomeOf(one).ok).length
  if (face === 'out') return <B pieces={pieces} unverified={unverified} face={face} />
  if (pieces.length === 0 && unverified.length === 0) return <p className={s.footerNone}>Nothing shown</p>
  return (
    <div className={s.footer}>
      <button type="button" className={s.footerLine} aria-expanded={open} onClick={() => setOpen(!open)}>
        {pictures.length > 0 && (
          <span className={s.count}>
            <Icon name="image" size={12} />
            {plural(pictures.length, 'screenshot')}
          </span>
        )}
        {outputs.length > 0 && (
          <span className={s.count}>
            <span className={[s.mark, s.small, failed > 0 ? s.bad : s.ok].join(' ')}>
              <Icon name={failed > 0 ? 'close' : 'check'} size={8} />
            </span>
            {failed > 0 ? `${failed} of ${plural(outputs.length, 'run')} failed` : `${plural(outputs.length, 'run')} passed`}
          </span>
        )}
        {unverified.length > 0 && (
          <span className={[s.count, s.yoursText].join(' ')}>
            <span className={[s.mark, s.small, s.open].join(' ')} />
            {unverified.length} yours to check
          </span>
        )}
        {!open && pictures.length > 0 && (
          <span className={s.peek}>
            {pictures.slice(0, 4).map((one) => (
              <span key={one.id} className={s.peekShot}>
                <ImageView image={one.shot} fit="cover" size="thumb" />
              </span>
            ))}
          </span>
        )}
        <span className={s.footerCaret}>
          <Icon name="chevronD" size={12} />
        </span>
      </button>
      {open && (
        <div className={s.footerOpen}>
          <GalleryFirst pieces={pieces} unverified={unverified} face="thread" />
        </div>
      )}
    </div>
  )
}

/* ---------- E · a short write-up ---------- */

export function E({ pieces, unverified, face }: DirectionProps) {
  const scenario = useScenario()
  const byPlace = new Map(pieces.map((one) => [placeOf(one), one]))
  const pictures = pieces.filter(isPicture)
  const inAreas = new Set(scenario.areas.flatMap((area) => area.pieces))
  const openInAreas = new Set(scenario.areas.flatMap((area) => area.open ?? []))
  const loose = pieces.filter((one) => !inAreas.has(placeOf(one)))
  const looseOpen = unverified.filter((_, i) => !openInAreas.has(i))
  if (pieces.length === 0 && unverified.length === 0)
    return face === 'out' ? (
      <article className={s.doc}>
        <Built source={scenario.built} />
        <NothingShown>The lead showed nothing of it working, and named nothing for you to check.</NothingShown>
      </article>
    ) : (
      <NothingShown>Nothing shown for this step</NothingShown>
    )
  if (face === 'thread')
    return (
      <div className={s.stack}>
        <Label level={4}>Shown, by area</Label>
        <ul className={s.areaLines}>
          {scenario.areas.map((area) => {
            const own = area.pieces.flatMap((place) => byPlace.get(place) ?? [])
            const shots = own.filter(isPicture)
            const runs = own.filter(isOutput)
            return (
              <li key={area.title}>
                <span className={s.areaName}>{area.title}</span>
                <span className={s.dim}>
                  {[shots.length > 0 && plural(shots.length, 'screenshot'), runs.length > 0 && plural(runs.length, 'run')]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {(area.open?.length ?? 0) > 0 && <span className={s.yoursText}>{area.open?.length} to check</span>}
              </li>
            )
          })}
        </ul>
        <LinkButton className={s.toOutputs} onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }))}>
          Read the write-up on Outputs
        </LinkButton>
      </div>
    )
  // Figures numbered through the write-up, in the order of its areas.
  const figureOf = new Map(
    scenario.areas
      .flatMap((area) => area.pieces)
      .filter((place) => byPlace.get(place)?.form === 'picture')
      .map((place, i) => [place, i + 1]),
  )
  return (
    <article className={s.doc}>
      <Built source={scenario.built} />
      {scenario.areas.length > 0 && (
        <p className={s.contents}>
          <span className={s.dim}>In this write-up:</span> {scenario.areas.map((area) => area.title).join(' · ')}
        </p>
      )}
      {scenario.areas.map((area) => {
        const own = area.pieces.flatMap((place) => byPlace.get(place) ?? [])
        const shots = own.filter(isPicture)
        const runs = own.filter(isOutput)
        const open = (area.open ?? []).flatMap((i) => unverified[i] ?? [])
        return (
          <section key={area.title} className={s.area}>
            <h2 className={s.areaTitle}>
              {area.title}
              {area.files !== undefined && <code className={s.files}>{area.files}</code>}
            </h2>
            {shots.length > 0 && (
              <div className={s.figures}>
                {shots.map((one) => {
                  const figure = figureOf.get(placeOf(one))
                  return (
                    <div key={one.id} className={s.figure}>
                      <Shot picture={one} set={pictures} caption={false} />
                      <p className={s.figcaption}>
                        <b>Figure {figure}.</b> {one.caption}
                      </p>
                    </div>
                  )
                })}
              </div>
            )}
            {runs.length > 0 && (
              <div>
                {runs.map((one) => (
                  <Receipt key={one.id} piece={one} />
                ))}
              </div>
            )}
            {open.length > 0 && (
              <div className={s.callout}>
                <p className={s.calloutTitle}>Still to check here</p>
                <ToCheck lines={open} title={false} />
              </div>
            )}
          </section>
        )
      })}
      {loose.length > 0 && (
        <section className={s.area}>
          <h2 className={s.areaTitle}>{scenario.areas.length > 0 ? 'Also shown' : 'Shown'}</h2>
          <Gallery pictures={loose.filter(isPicture)} />
          {loose.filter(isOutput).map((one) => (
            <Receipt key={one.id} piece={one} />
          ))}
          {notes(loose)}
        </section>
      )}
      {looseOpen.length > 0 && (
        <section className={s.area}>
          <h2 className={s.areaTitle}>Still to check</h2>
          <div className={s.callout}>
            <ToCheck lines={looseOpen} title={false} />
          </div>
        </section>
      )}
    </article>
  )
}
