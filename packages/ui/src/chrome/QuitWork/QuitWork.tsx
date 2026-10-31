import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import s from './QuitWork.module.css'

/*
 * Quit with work under way (DEV-118): it names what quitting stops, in a few
 * words, and asks. Cancel, first, has focus as it opens. Where Althar has the
 * edge or a tray to stay in reach by, it also offers to keep working in the
 * background: the windows close and the work carries on. An update that is
 * waiting says quitting installs it now. Nothing happens until a button is
 * pressed; with nothing at work Quit doesn't ask, so this has no state for it.
 */

/** What quitting would stop, counted. */
export interface QuitWorkCounts {
  /** Leads in a turn. */
  leads?: number
  /** Reviewers in a turn. */
  reviews?: number
  /** Project runs still going. */
  runs?: number
  /** What agents left running in the background, such as a dev server. */
  left?: number
}

export interface QuitWorkText {
  title: string
  /** What quitting stops: the parts, in a sentence. */
  stops: (parts: ReadonlyArray<string>) => string
  /** What quitting says where nothing could be counted: the runtime didn't answer. */
  mayStop: string
  leads: (count: number) => string
  reviews: (count: number) => string
  runs: (count: number) => string
  left: (count: number) => string
  /** An update waits; the version, as words: 0.7.0. */
  update: (version: string) => string
  cancel: string
  background: string
  quit: string
}

const many = (count: number, one: string, others: string) => `${count} ${count === 1 ? one : others}`

export const quitWorkText: QuitWorkText = {
  title: 'Quit Althar?',
  stops: (parts) =>
    `Quitting stops ${parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`}.`,
  mayStop: 'Quitting may stop work that is under way.',
  leads: (count) => many(count, 'lead at work', 'leads at work'),
  reviews: (count) => many(count, 'review', 'reviews'),
  runs: (count) => many(count, 'run', 'runs'),
  left: (count) => many(count, 'thing left running', 'things left running'),
  update: (version) => `Althar ${version} waits for the work to finish. Quitting installs it now.`,
  cancel: 'Cancel',
  background: 'Keep working in the background',
  quit: 'Quit anyway',
}

export interface QuitWorkProps {
  work: QuitWorkCounts
  /** Keeping the work going with the windows closed is on offer: Althar stays at the edge or in the tray. */
  background?: boolean
  /** The version of an update that is waiting to install. */
  update?: string
  onQuit: () => void
  onBackground: () => void
  /** Cancel, Escape or a click outside. */
  onCancel: () => void
  text?: Partial<QuitWorkText>
}

/** The parts of what stops, in the order a person thinks of them, those there are none of left out. */
export const stoppingParts = (work: QuitWorkCounts, t: QuitWorkText = quitWorkText): ReadonlyArray<string> =>
  [
    work.leads ? t.leads(work.leads) : null,
    work.reviews ? t.reviews(work.reviews) : null,
    work.runs ? t.runs(work.runs) : null,
    work.left ? t.left(work.left) : null,
  ].filter((part) => part !== null)

export function QuitWork({ work, background = false, update, onQuit, onBackground, onCancel, text }: QuitWorkProps) {
  const t = { ...quitWorkText, ...text }
  const parts = stoppingParts(work, t)
  return (
    <Dialog
      title={t.title}
      description={parts.length === 0 ? t.mayStop : t.stops(parts)}
      onClose={onCancel}
      width={background ? 520 : 440}
      actions={
        <>
          <Button variant="quiet" onClick={onCancel}>
            {t.cancel}
          </Button>
          {background && <Button onClick={onBackground}>{t.background}</Button>}
          <Button variant="danger" onClick={onQuit}>
            {t.quit}
          </Button>
        </>
      }
    >
      {update !== undefined && <p className={s.update}>{t.update(update)}</p>}
    </Dialog>
  )
}
