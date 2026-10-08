import { Popover as P } from 'radix-ui'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import s from './WorkStatus.module.css'

/*
 * The project's work in two words, at the right of the bar: how many tasks
 * are running, and how many calls wait on you. The second is a way in: it
 * opens the first of them. Pointed at, or with ArrowDown, it shows what
 * they are, each a way into its own; the one already on screen shows, but
 * isn't a way anywhere. With none, it says so and does nothing.
 */

export interface WorkStatusText {
  running: (n: number) => string
  yours: (n: number) => string
  none: string
  /** The preview's name, for its landmark. */
  preview: string
  /** Said of the need already on screen, in place of how long it has waited. */
  here: string
}

export const workStatusText: WorkStatusText = {
  running: (n) => `${n} running`,
  yours: (n) => (n === 1 ? '1 needs you' : `${n} need you`),
  /* scoped to this project: another one may still need you, and says so beside it */
  none: 'Nothing here needs you',
  preview: 'What needs you',
  here: 'This task',
}

/** One thing that waits on you, as the preview lists it. */
export interface WorkNeed {
  id: string
  /** What it is, in a word or two: Permission, Stuck, Ready to accept. */
  kind: string
  title: string
  /** A quiet line under the title: the task a call comes from, or the pull request or branch of work ready to accept. */
  meta?: string
  /** How long it has waited, as words: 4m ago. */
  at?: string
  /** It is what the window already shows: listed, but not a way in. */
  here?: boolean
  onOpen: () => void
}

export interface WorkStatusProps {
  running: number
  yours: number
  /** Open the first call that waits on you. Without it, the count is words, not a button. */
  onYours?: () => void
  /** The dot rings. Only the home's bar asks for it: it is the one place where what needs you is meant to pull the eye. */
  ring?: boolean
  /** What waits on you, shown while the count is pointed at; without them, no preview. */
  needs?: ReadonlyArray<WorkNeed>
  className?: string
  text?: Partial<WorkStatusText>
}

export function WorkStatus({ running, yours, onYours, needs, ring = false, className, text }: WorkStatusProps) {
  const t = { ...workStatusText, ...text }
  return (
    <span className={cx(s.status, className)}>
      {running > 0 && (
        <span className={s.running}>
          <LiveDot />
          {t.running(running)}
        </span>
      )}
      <Yours yours={yours} onYours={onYours} needs={needs} ring={ring} t={t} />
    </span>
  )
}

function Yours({
  yours,
  onYours,
  needs,
  ring,
  t,
}: {
  yours: number
  onYours?: () => void
  needs?: ReadonlyArray<WorkNeed>
  ring: boolean
  t: WorkStatusText
}) {
  if (yours === 0) return <span className={s.none}>{t.none}</span>
  const said = (
    <>
      <LiveDot signal ping={ring} className={s.dot} />
      {t.yours(yours)}
    </>
  )
  if (!onYours) return <span className={s.yoursText}>{said}</span>
  if (needs === undefined || needs.length === 0)
    return (
      <ActionButton tone="strong" onClick={onYours}>
        {said}
      </ActionButton>
    )
  return <Preview said={said} onYours={onYours} needs={needs} t={t} />
}

/** How long the pointer rests before the preview opens, and lingers after it leaves. */
const OPEN_DELAY = 180
const CLOSE_DELAY = 160

/**
 * The count with what it counts beside it: opened by pointing at the count
 * (focus stays where it was) or by ArrowDown on it (focus goes to the first
 * row). The arrow keys move between the rows, Escape goes back to the count.
 */
function Preview({ said, onYours, needs, t }: { said: ReactNode; onYours: () => void; needs: ReadonlyArray<WorkNeed>; t: WorkStatusText }) {
  const [open, setOpen] = useState(false)
  const byKeyboard = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const count = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()
  useEffect(() => () => clearTimeout(timer.current), [])

  const later = (next: boolean, delay: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      byKeyboard.current = false
      setOpen(next)
    }, delay)
  }
  const stay = () => clearTimeout(timer.current)
  const rows = () => [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  const step = (event: KeyboardEvent<HTMLButtonElement>) => {
    const all = rows()
    const at = all.indexOf(event.currentTarget)
    const to =
      event.key === 'ArrowDown'
        ? all[(at + 1) % all.length]
        : event.key === 'ArrowUp'
          ? all[(at - 1 + all.length) % all.length]
          : event.key === 'Home'
            ? all[0]
            : event.key === 'End'
              ? all.at(-1)
              : undefined
    if (to === undefined) return
    event.preventDefault()
    to.focus()
  }

  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Anchor asChild>
        <ActionButton
          ref={count}
          tone="strong"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-keyshortcuts="ArrowDown"
          onClick={onYours}
          onPointerEnter={() => later(true, OPEN_DELAY)}
          onPointerLeave={() => later(false, CLOSE_DELAY)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return
            event.preventDefault()
            clearTimeout(timer.current)
            byKeyboard.current = true
            if (open) rows()[0]?.focus()
            else setOpen(true)
          }}
        >
          {said}
        </ActionButton>
      </P.Anchor>
      <P.Portal>
        <P.Content
          id={id}
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className={cx('ch-root', s.preview)}
          onPointerEnter={stay}
          onPointerLeave={() => later(false, CLOSE_DELAY)}
          // Pointed at, it opens beside what has focus; asked for by the keyboard, focus goes to its first row.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (byKeyboard.current) rows()[0]?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (byKeyboard.current) count.current?.focus()
            byKeyboard.current = false
          }}
          // Pointing back at the count isn't leaving.
          onInteractOutside={(event) => {
            if (event.target instanceof Node && count.current?.contains(event.target)) event.preventDefault()
          }}
        >
          <ul ref={list} className={s.needs} aria-label={t.preview}>
            {needs.map((need) => (
              <li key={need.id}>
                {need.here === true ? (
                  <div className={cx(s.need, s.here)}>
                    <Row need={need} at={t.here} />
                  </div>
                ) : (
                  <button
                    type="button"
                    className={s.need}
                    onKeyDown={step}
                    onClick={() => {
                      setOpen(false)
                      need.onOpen()
                    }}
                  >
                    <Row need={need} at={need.at} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

function Row({ need, at }: { need: WorkNeed; at: string | undefined }) {
  return (
    <>
      <span className={s.needHead}>
        <span className={s.kind}>{need.kind}</span>
        {at !== undefined && at !== '' && <span className={s.at}>{at}</span>}
      </span>
      <span className={s.title}>{need.title}</span>
      {need.meta !== undefined && need.meta !== '' && <span className={s.meta}>{need.meta}</span>}
    </>
  )
}
