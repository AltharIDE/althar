import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { BoardTask } from '@althar/contracts'
import { type Aside, AsideMoves, AsideTabs, Button, Icon, IconButton } from '@althar/ui'

import { coordinatorSigned } from '../../shared/signed'
import { ago } from '../../shared/time'
import { TaskView } from '../task/TaskView'
import { useTask } from '../task/useTask'
import s from './Asides.module.css'

/*
 * Asides (docs/decisions/tasks.md, "Asides"): the project's chats, the tasks
 * on Scratch, as pills over the coordinator's conversation. One open shows its
 * own conversation in the coordinator's place, with the composer every task
 * has, its runs over it and its own moves (Make it a task, Clear); a new one
 * is started from the coordinator's composer, which sends to it instead.
 * Words the coordinator said, selected, start one about them. One that leaves
 * Scratch for the board, by its agent's work or the person's word, flies to
 * its card there, and the coordinator's conversation keeps a line of it.
 */

export const asidesText = {
  newPlaceholder: 'Ask on the side',
  quotePlaceholder: 'Ask about this, on the side',
  dropQuote: 'Drop the quote',
  askAside: 'Ask in an aside',
  quoting: 'Quoting the coordinator',
  asked: (when: string) => `Asked ${when}`,
}

/** What the coordinator's pane shows: its own conversation, a new aside being started, or an aside. */
export type AsideOpen =
  | { readonly kind: 'coordinator' }
  | { readonly kind: 'new'; readonly quote: string | null }
  | { readonly kind: 'aside'; readonly taskId: string; readonly threadId: string }

export const COORDINATOR: AsideOpen = { kind: 'coordinator' }

/** An aside left untouched this long folds into "N older", which clears them together (docs/open-questions.md). */
const OLDER = 7 * 24 * 60 * 60 * 1000

const asideOf = (task: BoardTask): Aside => ({
  id: task.taskId,
  title: task.title,
  ...(task.latest === undefined ? {} : { said: task.latest.said }),
  ...(task.phase === 'running' ? { running: true } : {}),
})

/** The asides, the latest first, and those left a week, apart. */
export const asidesOf = (scratch: ReadonlyArray<BoardTask>, now: number) => {
  const old = (task: BoardTask) => now - Date.parse(task.latest?.at ?? task.createdAt) > OLDER
  return { recent: scratch.filter((task) => !old(task)).map(asideOf), older: scratch.filter(old).map(asideOf) }
}

/** A title for an aside from the person's words: their first line, cut at a word. */
export const asideTitle = (words: string) => {
  const line = words.trim().split('\n')[0]?.trim() ?? ''
  if (line.length <= 80) return line
  const cut = line.slice(0, 80)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40))}…`
}

/** The person's words to start an aside with, under what they quoted of the coordinator. */
export const asideWords = (words: string, quote: string | null) =>
  quote === null
    ? words
    : `${quote
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n\n${words}`

/** The pills over the coordinator's conversation, flying one that left for the board to its card there. */
export function AsidesBar({
  scratch,
  open,
  onOpen,
  onClear,
  board,
  now,
}: {
  scratch: ReadonlyArray<BoardTask>
  open: AsideOpen
  onOpen: (open: AsideOpen) => void
  /** Settles asides: they leave the pills, and ⌘K still finds them. */
  onClear: (taskIds: ReadonlyArray<string>) => void
  /** Every task on the board, to tell one that left for the board from one cleared. */
  board: ReadonlyArray<BoardTask>
  now: number
}) {
  const { recent, older } = asidesOf(scratch, now)
  const strip = useRef<HTMLDivElement>(null)
  useFlights(strip, scratch, board)
  const current = open.kind === 'aside' ? open.taskId : null
  const pick = (id: string | null) => {
    const task = id === null ? undefined : scratch.find((one) => one.taskId === id)
    onOpen(task === undefined ? COORDINATOR : { kind: 'aside', taskId: task.taskId, threadId: task.threadId })
  }
  return (
    <AsideTabs
      ref={strip}
      className={s.bar}
      mark={coordinatorSigned.mark}
      asides={recent}
      older={older}
      current={current}
      starting={open.kind === 'new'}
      onPick={pick}
      onNew={() => onOpen({ kind: 'new', quote: null })}
      onClearOlder={onClear}
    />
  )
}

/**
 * An aside that left Scratch for the board flies from its pill to its card
 * there, or to the Board tab with the board closed; one cleared just goes.
 */
function useFlights(strip: RefObject<HTMLDivElement | null>, scratch: ReadonlyArray<BoardTask>, board: ReadonlyArray<BoardTask>) {
  // Where each pill was, last drawn: once it leaves, it is gone from the page.
  const rects = useRef(new Map<string, { rect: DOMRect; node: HTMLElement }>())
  const was = useRef<ReadonlySet<string>>(new Set(scratch.map((task) => task.taskId)))
  useLayoutEffect(() => {
    const ids = new Set(scratch.map((task) => task.taskId))
    for (const id of was.current) {
      if (ids.has(id)) continue
      const left = board.find((task) => task.taskId === id)
      const from = rects.current.get(id)
      if (left === undefined || left.scratch === true || left.phase === 'settled' || from === undefined) continue
      fly(from.node, from.rect, id)
    }
    was.current = ids
    rects.current = new Map(
      [...(strip.current?.querySelectorAll<HTMLElement>('[data-aside]') ?? [])].map((node) => [
        node.dataset.aside ?? '',
        { rect: node.getBoundingClientRect(), node: node.cloneNode(true) as HTMLElement },
      ]),
    )
  })
}

const fly = (ghost: HTMLElement, from: DOMRect, taskId: string) => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  // Its card, once the board has drawn it; with the board closed, the tab that opens it.
  const target = () =>
    document.querySelector<HTMLElement>(`[data-move="${CSS.escape(taskId)}"]`) ??
    [...document.querySelectorAll<HTMLElement>('[role="radio"], [role="tab"]')].find((one) => one.textContent?.trim() === 'Board') ??
    null
  requestAnimationFrame(() => {
    const to = target()
    if (to === null) return
    const end = to.getBoundingClientRect()
    ghost.classList.add(s.ghost ?? '')
    Object.assign(ghost.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` })
    document.body.append(ghost)
    const dx = end.left + Math.min(end.width, 200) / 2 - (from.left + from.width / 2)
    const dy = end.top + Math.min(end.height, 40) / 2 - (from.top + from.height / 2)
    const flight = ghost.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 50}px) scale(1.05)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.9)`, opacity: 0.4 },
      ],
      { duration: 700, easing: 'cubic-bezier(0.5, 0, 0.2, 1)' },
    )
    void flight.finished.then(() => {
      ghost.remove()
      to.setAttribute('data-arrived', '')
      setTimeout(() => to.removeAttribute('data-arrived'), 1400)
    })
  })
}

/** An aside open in the coordinator's place: its conversation and composer, as on its own screen, with its moves over the composer. */
export function AsideConversation({
  threadId,
  onBack,
  onOpenTask,
}: {
  threadId: string
  /** Back to the coordinator's conversation: once it is cleared. */
  onBack: () => void
  onOpenTask: (threadId: string) => void
}) {
  const model = useTask(threadId)
  const task = model.snapshot?.task
  const request = task?.request ?? null
  const quoted = request?.startsWith('> ') === true
  return (
    <TaskView
      model={model}
      onBack={onBack}
      onOpenTask={onOpenTask}
      aside={{
        bar:
          task === undefined || task.scratch !== true || task.phase === 'settled' ? null : (
            <AsideMoves
              busy={model.pending}
              onMakeTask={() => void model.shelve(null)}
              onClear={() => void model.markDone().then(onBack)}
              {...(quoted ? { note: asidesText.quoting } : task.startedAt === null ? {} : { note: asidesText.asked(ago(task.startedAt)) })}
            />
          ),
      }}
    />
  )
}

/** What a new aside quotes of the coordinator, over the composer, with a way to drop it. */
export function AsideQuote({ quote, onDrop }: { quote: string; onDrop: () => void }) {
  return (
    <div className={s.quote}>
      <Icon name="quote" size={12} />
      <span className={s.quoteText}>{quote}</span>
      <IconButton icon="close" size="small" label={asidesText.dropQuote} onClick={onDrop} />
    </div>
  )
}

/** Words the coordinator said, selected in its conversation: a button over them that starts an aside about them. */
export function AskInAside({ within, onAsk }: { within: RefObject<HTMLElement | null>; onAsk: (quote: string) => void }) {
  const [at, setAt] = useState<{ x: number; y: number; text: string } | null>(null)
  useEffect(() => {
    const look = () => {
      const selection = document.getSelection()
      const text = selection?.toString().trim() ?? ''
      const root = within.current
      if (selection === null || selection.rangeCount === 0 || text === '' || root === null) return setAt(null)
      const range = selection.getRangeAt(0)
      const node = range.commonAncestorContainer
      const element = node instanceof Element ? node : node.parentElement
      // Only what an agent said: a turn, in the coordinator's conversation.
      const turn = element?.closest('article')
      if (turn == null || !root.contains(turn)) return setAt(null)
      const rect = range.getBoundingClientRect()
      setAt({ x: rect.left + rect.width / 2, y: rect.top, text })
    }
    const later = () => setTimeout(look, 0)
    const gone = () => setAt(null)
    document.addEventListener('mouseup', later)
    document.addEventListener('keyup', later)
    document.addEventListener('scroll', gone, true)
    return () => {
      document.removeEventListener('mouseup', later)
      document.removeEventListener('keyup', later)
      document.removeEventListener('scroll', gone, true)
    }
  }, [within])
  if (at === null) return null
  return createPortal(
    <div className={s.ask} style={{ left: at.x, top: at.y }}>
      <Button
        size="small"
        icon="quote"
        // Pressed, the selection stays until the aside takes it.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onAsk(at.text.length > 600 ? `${at.text.slice(0, 600)}…` : at.text)
          document.getSelection()?.removeAllRanges()
          setAt(null)
        }}
      >
        {asidesText.askAside}
      </Button>
    </div>,
    document.body,
  )
}
