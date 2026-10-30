import type { ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { ImageView } from '../Lightbox/Lightbox'
import { Markdown } from '../Markdown/Markdown'
import { useThreadShell, type ImageRef } from '../Shell/Shell'
import s from './WorkLine.module.css'

export interface WorkLineText {
  /** How long it worked, once it's done. */
  worked: (took: string) => string
  /** How long it has worked so far. */
  working: (took: string) => string
  /** The same, after the name of who worked, for a round that said nothing. */
  workedBy: (took: string) => string
  workingBy: (took: string) => string
}

export const workLineText: WorkLineText = {
  worked: (took) => `Worked ${took}`,
  working: (took) => `Working · ${took}`,
  workedBy: (took) => `worked ${took}`,
  workingBy: (took) => `working · ${took}`,
}

export interface WorkLineProps extends Disclosable {
  /** How long it worked, or has so far. */
  took: string
  /** It is still at work: the line says so, and what it is on. */
  live?: boolean
  /** What it did, counted ("edited 3 files, ran 4 commands"); while it works, what it is on, in its own last words. */
  summary?: string
  /** Who worked, for a round that said nothing: the line stands for the whole round. */
  who?: ModelInfo
  /** Every step of the work, in order, shown when opened. Without them, the line doesn't open. */
  children?: ReactNode
  className?: string
  text?: Partial<WorkLineText>
}

/**
 * All the work of a round of a task's thread, in one faint line between what
 * its lead says: how long it took, and what it did, counted. It sits back, so
 * it never competes with the words. Opened, every step of it in order, on a
 * quiet sheet in the same column, what it said on the way among them; closed,
 * nothing is left under it. While the lead works, the line says what it is on.
 */
export function WorkLine({ took, live = false, summary, who, children, className, text, ...disclosure }: WorkLineProps) {
  const t = { ...workLineText, ...text }
  const words = who === undefined ? (live ? t.working(took) : t.worked(took)) : live ? t.workingBy(took) : t.workedBy(took)
  const line = (
    <>
      {who !== undefined && <Model model={who} className={s.who} />}
      <span className={s.mark}>
        {live ? <Spinner size="small" /> : children !== undefined && <Icon name="chevron" size={11} className={s.chevron} />}
      </span>
      <span className={s.took}>{words}</span>
      {/* While it works, each new step it names comes in by a fade, not a flip. */}
      {summary !== undefined && summary !== '' && (
        <span key={summary} className={cx(s.summary, live && s.relabelled)}>
          {summary}
        </span>
      )}
    </>
  )
  if (children === undefined)
    return (
      <div className={cx(s.work, className)}>
        <div className={s.row} aria-busy={live || undefined}>
          {line}
        </div>
      </div>
    )
  return (
    <Disclosure {...disclosure} className={cx(s.work, className)}>
      <DisclosureTrigger>
        <button type="button" className={s.row} aria-busy={live || undefined}>
          {line}
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <div className={s.body}>{children}</div>
      </Fold>
    </Disclosure>
  )
}

/** What the lead said on the way, inside its work: smaller and quieter than what it says to the person. */
export function WorkSaid({ source }: { source: string }) {
  return (
    <div className={s.said}>
      <Markdown source={source} />
    </div>
  )
}

/** A line inside the work that isn't a step: a thought, or what Althar did along the way. */
export function WorkNote({ children }: { children: ReactNode }) {
  return <p className={s.note}>{children}</p>
}

/** Pictures the lead looked at as it worked, small under the step that read them; each opens full size, with the others a key away. */
export function WorkShots({
  shots,
  text,
}: {
  shots: ReadonlyArray<ImageRef & { id: string }>
  text?: { view?: (name: string) => string }
}) {
  const { openImage } = useThreadShell()
  const view = text?.view ?? ((name: string) => `View ${name} full size`)
  if (shots.length === 0) return null
  return (
    <div className={s.shots}>
      {shots.map((shot) =>
        openImage && shot.status !== 'failed' ? (
          <button key={shot.id} type="button" className={s.shot} onClick={() => openImage(shot, shots)} aria-label={view(shot.name)}>
            <ImageView image={shot} fit="cover" size="thumb" />
          </button>
        ) : (
          <span key={shot.id} className={s.shot}>
            <ImageView image={shot} fit="cover" size="thumb" />
          </span>
        ),
      )}
    </div>
  )
}
