import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { ImageView } from '../Lightbox/Lightbox'
import { useThreadShell, type ImageRef } from '../Shell/Shell'
import s from './Gallery.module.css'

export interface GalleryText {
  /** What a picture is called for opening it. */
  view: (caption: string) => string
  /** The line under a set that leaves out pictures shown before: its start, alone or after others. */
  retook: string
  alsoRetook: string
  and: string
  shownEarlier: string
}

export const galleryText: GalleryText = {
  view: (caption) => `View ${caption} full size`,
  retook: 'Retook',
  alsoRetook: 'It also retook',
  and: ' and ',
  shownEarlier: ', shown earlier.',
}

/** A picture the lead means the person to see, with what it shows. */
export interface GalleryShot extends ImageRef {
  readonly id: string
  readonly caption: string
}

/** "A1 · One quiet line: the first message lands", or "T1 Today: …": the picture's name, A1, where its caption starts with one. */
const NAMED = /^([A-Z])(\d*)\s*[·:]\s*(.+)$|^([A-Z])(\d+)\s+(.+)$/s

const named = (caption: string) => {
  const found = NAMED.exec(caption)
  if (found === null) return null
  return { letter: (found[1] ?? found[4]) as string, n: found[2] ?? found[5] ?? '', rest: (found[3] ?? found[6]) as string }
}

/** A picture's name, from its caption, where it has one: A1, Z. A later picture of the same name is the same view taken again. */
export const shotName = (caption: string): string | null => {
  const found = named(caption)
  return found === null ? null : `${found.letter}${found.n}`
}

/** The group of pictures with no names. */
const UNNAMED = ''

interface Group {
  readonly key: string
  readonly title: string | null
  readonly shots: ReadonlyArray<{ readonly shot: GalleryShot; readonly caption: string }>
}

/**
 * The groups the pictures' names make (A1, A2, A3 together, then B1…). A
 * group whose first picture is its 1 and says what it is before a colon
 * ("A1 · One quiet line: …") goes under that, "A · One quiet line".
 */
const groupsOf = (shots: ReadonlyArray<GalleryShot>): ReadonlyArray<Group> => {
  const groups: Array<{ key: string; title: string | null; shots: Array<{ shot: GalleryShot; caption: string }> }> = []
  for (const shot of shots) {
    const found = named(shot.caption)
    const last = groups.at(-1)
    // Pictures of one name keep together, and so do pictures with none, two across.
    if (last !== undefined && last.key === (found?.letter ?? UNNAMED)) {
      last.shots.push({ shot, caption: shot.caption })
      continue
    }
    const colon = found === null ? -1 : found.rest.indexOf(':')
    const title = found !== null && found.n === '1' && colon > 0 && colon < 50 ? found.rest.slice(0, colon).trim() : null
    groups.push({
      key: found?.letter ?? UNNAMED,
      title,
      shots: [
        { shot, caption: found === null || title === null ? shot.caption : `${found.letter}1 · ${found.rest.slice(colon + 1).trim()}` },
      ],
    })
  }
  return groups
}

/** A picture far taller than wide, a whole page: it shows its top, and opens whole. */
const tall = (shot: ImageRef) => shot.width !== undefined && shot.height !== undefined && shot.height / shot.width > 0.9

export type GalleryProps = RootProps<
  'div',
  {
    /** The pictures, in order; each opens full size with the others a key away. */
    shots: ReadonlyArray<GalleryShot>
    /** Pictures of views shown earlier in the thread, taken again: named in a line under the set, each opening on a click. */
    retaken?: ReadonlyArray<GalleryShot>
    text?: Partial<GalleryText>
  }
>

/**
 * The screenshots a lead means the person to see, with its result: every one
 * of them, two across, large, wider than the words, each with its whole
 * caption under it, in the groups their names make. One alone is wider
 * still. Views it showed before and took again aren't shown twice: a line
 * names them.
 */
export function Gallery({ shots, retaken = [], text, className, ...rest }: GalleryProps) {
  const t = { ...galleryText, ...text }
  const { openImage } = useThreadShell()
  if (shots.length === 0 && retaken.length === 0) return null
  const one = shots.length === 1
  return (
    <div className={cx(s.gallery, className)} {...rest}>
      {shots.length > 0 && (
        <div className={one ? s.wideOne : s.wide}>
          {groupsOf(shots).map((group) => (
            <section key={`${group.key}:${group.shots[0]?.shot.id}`} className={s.group} aria-label={group.title ?? undefined}>
              {group.title !== null && (
                <h4 className={s.groupTitle}>
                  {group.key} · {group.title}
                </h4>
              )}
              <div className={one ? s.shotsOne : s.shots}>
                {group.shots.map(({ shot, caption }) => (
                  <figure key={shot.id} className={s.shot}>
                    {openImage && shot.status !== 'failed' ? (
                      <button type="button" className={s.image} onClick={() => openImage(shot, shots)} aria-label={t.view(shot.caption)}>
                        <Picture shot={shot} />
                      </button>
                    ) : (
                      <span className={s.image}>
                        <Picture shot={shot} />
                      </span>
                    )}
                    <figcaption className={s.caption}>{caption}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {retaken.length > 0 && (
        <p className={s.retaken}>
          {shots.length === 0 ? t.retook : t.alsoRetook}{' '}
          {retaken.map((shot, index) => (
            <span key={shot.id}>
              {index > 0 && (index === retaken.length - 1 ? t.and : ', ')}
              {openImage === undefined || shot.status === 'failed' ? (
                <span>{shotName(shot.caption) ?? shot.name}</span>
              ) : (
                <LinkButton className={s.retake} onClick={() => openImage(shot, retaken)} aria-label={t.view(shot.caption)}>
                  {shotName(shot.caption) ?? shot.name}
                </LinkButton>
              )}
            </span>
          ))}
          {t.shownEarlier}
        </p>
      )}
    </div>
  )
}

function Picture({ shot }: { shot: GalleryShot }) {
  const whole = tall(shot)
  return (
    <span
      className={cx(s.frame, whole && s.tall)}
      style={
        !whole && shot.width !== undefined && shot.height !== undefined ? { aspectRatio: `${shot.width} / ${shot.height}` } : undefined
      }
    >
      <ImageView image={shot} fit={whole ? 'cover' : 'contain'} size="thumb" />
    </span>
  )
}
