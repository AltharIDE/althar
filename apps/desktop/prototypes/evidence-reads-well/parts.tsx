import { type ReactNode, useState } from 'react'

import {
  Caret,
  Disclosure,
  DisclosureTrigger,
  type EvidencePiece,
  Fold,
  Icon,
  type ImageRef,
  ImageView,
  Markdown,
  Terminal,
  useThreadShell,
} from '../../../../packages/ui/src/index'
import s from './directions.module.css'

/*
 * What the directions share, built from the kit's own parts: the summary
 * of what was built (mocked as the task beside this one draws it), a
 * picture that opens the lightbox with its set, a receipt for something
 * that ran, and the marks a proof list uses.
 */

export type Picture = Extract<EvidencePiece, { form: 'picture' }>
export type Output = Extract<EvidencePiece, { form: 'output' }>

/** A piece's place in its step's evidence, from its id. */
export const placeOf = (piece: EvidencePiece) => Number(piece.id.slice(piece.id.lastIndexOf(':') + 1))

export const isPicture = (piece: EvidencePiece): piece is Picture => piece.form === 'picture'
export const isOutput = (piece: EvidencePiece): piece is Output => piece.form === 'output'

/** The set the lightbox steps through, in the order given, each with its caption. */
export const imagesOf = (pictures: readonly Picture[]): ImageRef[] => pictures.map((one) => ({ ...one.shot, label: one.caption }))

/** What a run says of how it went, in a few words: its counts where it printed them, else its exit. */
export const outcomeOf = (piece: Output): { readonly ok: boolean; readonly words: string } => {
  const text = [...(piece.earlier ?? []), ...piece.lines].join('\n')
  const failed = /(\d+) failed/.exec(text)?.[1]
  const passed = /Tests\s+(?:\d+ failed \| )?(\d+) passed/.exec(text)?.[1] ?? /(\d+) passed/.exec(text)?.[1]
  const ok = piece.exit === undefined ? true : piece.exit === 0
  if (failed !== undefined && passed !== undefined) return { ok, words: `${failed} failed, ${passed} passed` }
  if (passed !== undefined) return { ok, words: `${passed} passed` }
  if (piece.exit !== undefined) return { ok, words: ok ? 'passed' : `exit ${piece.exit}` }
  return { ok, words: '' }
}

/** What it built: the task's one summary, above the proof. Mocked as the summary task draws it, from the kit's label and Markdown. */
export function Built({ source }: { source: string }) {
  return (
    <section className={s.built}>
      <h2 className={s.label}>What it built</h2>
      <Markdown source={source} />
    </section>
  )
}

export function Label({ children, level = 2 }: { children: ReactNode; level?: 2 | 3 | 4 }) {
  const H = `h${level}` as const
  return <H className={s.label}>{children}</H>
}

/** A picture that opens full size, with the others of its set a key away. */
export function Shot({
  picture,
  set,
  n,
  size = 'full',
  caption = true,
  className,
}: {
  picture: Picture
  set: readonly Picture[]
  n?: number
  size?: 'full' | 'thumb' | 'chip'
  caption?: boolean
  className?: string
}) {
  const { openImage } = useThreadShell()
  const images = imagesOf(set)
  const image = images[set.indexOf(picture)] ?? { ...picture.shot, label: picture.caption }
  return (
    <figure className={[s.shot, s[size], className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={s.picture}
        onClick={() => openImage?.(image, images)}
        aria-label={`View full size: ${picture.caption}`}
      >
        <ImageView image={picture.shot} fit="cover" size="thumb" />
        {n !== undefined && <span className={s.n}>{n}</span>}
      </button>
      {caption && <figcaption className={s.figcaption}>{picture.caption}</figcaption>}
    </figure>
  )
}

/** Something that ran, in a line: what it shows, how it went, opening to what it printed. */
export function Receipt({ piece, open }: { piece: Output; open?: boolean }) {
  const { ok, words } = outcomeOf(piece)
  return (
    <Disclosure defaultOpen={open ?? false}>
      <DisclosureTrigger>
        <button type="button" className={s.receipt}>
          <span className={[s.mark, ok ? s.ok : s.bad].join(' ')}>
            <Icon name={ok ? 'check' : 'close'} size={10} />
          </span>
          <span className={s.receiptCaption}>{piece.caption}</span>
          {words !== '' && <span className={[s.outcome, !ok && s.badText].filter(Boolean).join(' ')}>{words}</span>}
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <div className={s.printed}>
          <Terminal
            lines={piece.lines}
            {...(piece.command === undefined ? {} : { command: piece.command })}
            {...(piece.exit === undefined ? {} : { exit: piece.exit })}
            {...(piece.earlier === undefined ? {} : { earlier: piece.earlier })}
          />
        </div>
      </Fold>
    </Disclosure>
  )
}

/** A note the lead made, said as it said it. */
export function NoteLine({ piece }: { piece: Extract<EvidencePiece, { form: 'note' }> }) {
  return (
    <p className={s.note}>
      {piece.caption}
      {piece.text !== undefined && <span className={s.dim}> {piece.text}</span>}
    </p>
  )
}

/** What couldn't be shown: violet open circles, the person's to check. */
export function ToCheck({ lines, title = true, level = 2 }: { lines: readonly string[]; title?: boolean; level?: 2 | 3 | 4 }) {
  if (lines.length === 0) return null
  return (
    <section className={s.toCheck}>
      {title && <Label level={level}>Yours to check · {lines.length}</Label>}
      <ul className={s.checkList}>
        {lines.map((line) => (
          <li key={line}>
            <span className={[s.mark, s.open].join(' ')} aria-hidden="true" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A numbered grid of every picture, in order, each captioned in full. */
export function Gallery({
  pictures,
  set = pictures,
  columns = 2,
  start = 1,
}: {
  pictures: readonly Picture[]
  /** The whole set the lightbox steps through, where this grid is a part of it. */
  set?: readonly Picture[]
  columns?: number
  start?: number
}) {
  if (pictures.length === 0) return null
  return (
    <div className={s.gallery} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {pictures.map((one, i) => (
        <Shot key={one.id} picture={one} set={set} n={start + i} size={columns > 2 ? 'thumb' : 'full'} />
      ))}
    </div>
  )
}

/** What ran, as receipts under a quiet label. */
export function Receipts({ outputs, level = 2, title = 'Receipts' }: { outputs: readonly Output[]; level?: 2 | 3 | 4; title?: string }) {
  if (outputs.length === 0) return null
  return (
    <section className={s.receipts}>
      <Label level={level}>
        {title} · {outputs.length}
      </Label>
      <div>
        {outputs.map((one) => (
          <Receipt key={one.id} piece={one} />
        ))}
      </div>
    </section>
  )
}

/** The pictures of a step grouped as the scenario says, in its order; any left over after. */
export function useGroups(pictures: readonly Picture[], groups: readonly { title: string; pieces: readonly number[] }[]) {
  const [byPlace] = useState(() => new Map(pictures.map((one) => [placeOf(one), one])))
  const seen = new Set<number>()
  const out = groups.map((group) => ({
    title: group.title,
    pictures: group.pieces.flatMap((place) => {
      const one = byPlace.get(place)
      if (one === undefined) return []
      seen.add(place)
      return [one]
    }),
  }))
  const rest = pictures.filter((one) => !seen.has(placeOf(one)))
  return rest.length > 0
    ? [...out.filter((g) => g.pictures.length > 0), { title: groups.length > 0 ? 'Also' : '', pictures: rest }]
    : out.filter((g) => g.pictures.length > 0)
}

/** Nothing shown, said plainly: the absence is worth seeing. */
export function NothingShown({ children }: { children: ReactNode }) {
  return (
    <p className={s.nothing}>
      <span className={[s.mark, s.none].join(' ')} aria-hidden="true" />
      {children}
    </p>
  )
}
