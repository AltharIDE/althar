import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { BoardTask, PlanStep } from '@althar/contracts'
import { type Aside, AsideMoves, AsideTabs, Button, Icon, IconButton } from '@althar/ui'

import { type Client, newTaskId } from '../../data/client'
import { coordinatorSigned } from '../../shared/signed'
import { ago } from '../../shared/time'
import { TaskView } from '../task/TaskView'
import { useTask } from '../task/useTask'
import s from './Asides.module.css'

/*
 * Asides (docs/decisions/tasks.md, "Asides"): the project's chats, the tasks
 * on Scratch, as pills over the coordinator's conversation. One open shows its
 * own conversation in the coordinator's place, with the composer every task
 * has, its runs over it and its own moves (Make it a task, Clear). A new one
 * starts as + is pressed, by an id the window makes, so its worktree and its
 * lead get ready while the person writes and its one pill is keyed by that id
 * from the first frame; the coordinator's composer sends its first words to
 * it, which name it.
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

/**
 * What the coordinator's pane shows: its own conversation, a new aside waiting for its first words (its thread once the runtime
 * has made it), or an aside.
 */
export type AsideOpen =
  | { readonly kind: 'coordinator' }
  | { readonly kind: 'new'; readonly taskId: string; readonly threadId: string | null; readonly quote: string | null }
  | { readonly kind: 'aside'; readonly taskId: string; readonly threadId: string }

export const COORDINATOR: AsideOpen = { kind: 'coordinator' }

/** An aside left untouched this long folds into "N older", which clears them together (docs/open-questions.md). */
const OLDER = 7 * 24 * 60 * 60 * 1000

const asideOf = (task: BoardTask): Aside => ({
  id: task.taskId,
  title: task.title,
  ...(task.latest === undefined ? {} : { said: task.latest.said }),
  // Its lead waiting for the person's first words isn't at work.
  ...(task.phase === 'running' && task.unsaid !== true ? { running: true } : {}),
})

/**
 * The asides, the latest first, and those left a week, apart. The open one always has its pill; one left unsaid shows only
 * while it is open. The one just started (`first`) comes first, under the id it keeps, before the board has it, and after,
 * until the board has its first exchange: however the board's reads land, its one pill never moves or goes.
 */
export const asidesOf = (
  scratch: ReadonlyArray<BoardTask>,
  now: number,
  keep: { readonly open?: string | null; readonly first?: string | null } = {},
) => {
  const kept = (task: BoardTask) => task.taskId === keep.open || task.taskId === keep.first
  const shown = scratch.filter((task) => task.unsaid !== true || kept(task))
  const old = (task: BoardTask) => !kept(task) && now - Date.parse(task.latest?.at ?? task.createdAt) > OLDER
  const recent = shown.filter((task) => !old(task)).map(asideOf)
  const { first } = keep
  const ahead = first == null ? [] : [recent.find((one) => one.id === first) ?? { id: first, title: '' }]
  return { recent: [...ahead, ...recent.filter((one) => one.id !== first)], older: shown.filter(old).map(asideOf) }
}

/** The longest a task's title may be (the runtime's TITLE_LENGTH). */
const TITLE = 60

/** A title for an aside from the person's words: their first line, cut at a word to fit a task's title. */
export const asideTitle = (words: string) => {
  const line = words.trim().split('\n')[0]?.trim() ?? ''
  if (line.length <= TITLE) return line
  const cut = line.slice(0, TITLE - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), TITLE / 2)).trimEnd()}…`
}

/** The person's words to start an aside with, under what they quoted of the coordinator. */
export const asideWords = (words: string, quote: string | null) =>
  quote === null
    ? words
    : `${quote
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n\n${words}`

/**
 * Which conversation the coordinator's pane shows, and the starting of new asides: + starts one at once (`StartTask` with
 * `chat`), on the lead the composer has picked, by an id made here, so it is one pill from that moment, and its worktree and
 * lead get ready while the person writes. One opened and left unsaid is opened again by the next +, rather than another. The
 * person's first words go to its thread, under what it quotes, and name it.
 */
export function useAsides({
  client,
  projectId,
  lead,
  scratch,
  tasks,
}: {
  client: Client
  projectId: string | null
  /** Who leads a new one: the composer's pick. */
  lead: PlanStep | null
  scratch: ReadonlyArray<BoardTask>
  /** Every task on the board, to tell one that left Scratch. */
  tasks: ReadonlyArray<BoardTask>
}) {
  const [opened, setOpened] = useState<AsideOpen>(COORDINATOR)
  // The one whose first words just went from here: first among the pills until the board has its first exchange.
  const [sent, setSent] = useState<string | null>(null)
  // Each one started here, as its start lands: its thread, or null where it couldn't start.
  const starts = useRef(new Map<string, Promise<string | null>>())
  const task = opened.kind === 'coordinator' ? undefined : tasks.find((one) => one.taskId === opened.taskId)
  // One that left Scratch, for the board or cleared, gives the pane back to the coordinator.
  const open: AsideOpen = task !== undefined && (task.scratch !== true || task.phase === 'settled') ? COORDINATOR : opened
  const sentCard = sent === null ? undefined : scratch.find((one) => one.taskId === sent)
  const first = open.kind === 'new' ? open.taskId : sent !== null && sentCard?.latest === undefined ? sent : null

  const start = (taskId: string, quote: string | null) => {
    if (projectId === null || lead === null) return
    setOpened({ kind: 'new', taskId, threadId: null, quote })
    const made = client.startTask({ projectId, title: '', steps: [lead], chat: true, taskId }).then(
      (started) => {
        setOpened((current) => (current.kind === 'new' && current.taskId === taskId ? { ...current, threadId: started.threadId } : current))
        return started.threadId
      },
      () => null,
    )
    starts.current.set(taskId, made)
  }

  /** + over the conversation, or the coordinator's words asked about: a new aside, open, waiting for the person's words. */
  const begin = (quote: string | null) => {
    if (open.kind === 'new') return setOpened({ ...open, quote })
    const unsaid = scratch.find((one) => one.unsaid === true && one.phase !== 'settled')
    if (unsaid !== undefined) return setOpened({ kind: 'new', taskId: unsaid.taskId, threadId: unsaid.threadId, quote })
    start(newTaskId(), quote)
  }

  /** A pill: the coordinator's conversation, by null, or an aside's. */
  const pick = (taskId: string | null) => {
    if (open.kind === 'new' && open.taskId === taskId) return
    const one = taskId === null ? undefined : scratch.find((candidate) => candidate.taskId === taskId)
    if (one === undefined) return setOpened(COORDINATOR)
    setOpened(
      one.unsaid === true
        ? { kind: 'new', taskId: one.taskId, threadId: one.threadId, quote: null }
        : { kind: 'aside', taskId: one.taskId, threadId: one.threadId },
    )
  }

  /** The person's first words in the new aside: to its thread, under what it quotes, naming it; it opens. False for no words. */
  const say = async (body: string) => {
    if (open.kind !== 'new' || projectId === null || lead === null) return false
    const words = body.trim()
    if (words === '') return false
    const { taskId, quote } = open
    const said = asideWords(words, quote)
    const threadId = open.threadId ?? (await starts.current.get(taskId)) ?? null
    if (threadId === null) {
      // It couldn't start as + was pressed: once more, now, started with the words themselves.
      const again = await client.startTask({ projectId, title: asideTitle(words), description: said, steps: [lead], chat: true })
      setSent(again.id)
      setOpened({ kind: 'aside', taskId: again.id, threadId: again.threadId })
      return true
    }
    await Promise.all([
      client.renameTask(taskId, asideTitle(words)).catch(() => undefined),
      client.send({ threadId, body: said, disposition: 'after_current' }),
    ])
    setSent(taskId)
    setOpened((current) => (current.kind === 'new' && current.taskId === taskId ? { kind: 'aside', taskId, threadId } : current))
    return true
  }

  return {
    open,
    first,
    begin,
    pick,
    say,
    back: () => setOpened(COORDINATOR),
    dropQuote: () => setOpened((current) => (current.kind === 'new' ? { ...current, quote: null } : current)),
  }
}

/** The pills over the coordinator's conversation, flying one that left for the board to its card there. */
export function AsidesBar({
  scratch,
  open,
  first,
  onPick,
  onNew,
  onClear,
  board,
  now,
}: {
  scratch: ReadonlyArray<BoardTask>
  open: AsideOpen
  /** The one just started, first among them until the board has its first exchange (`useAsides`). */
  first: string | null
  onPick: (taskId: string | null) => void
  onNew: () => void
  /** Settles asides: they leave the pills, and ⌘K still finds them. */
  onClear: (taskIds: ReadonlyArray<string>) => void
  /** Every task on the board, to tell one that left for the board from one cleared. */
  board: ReadonlyArray<BoardTask>
  now: number
}) {
  const { recent, older } = asidesOf(scratch, now, { open: open.kind === 'coordinator' ? null : open.taskId, first })
  const strip = useRef<HTMLDivElement>(null)
  useFlights(strip, scratch, board)
  return (
    <AsideTabs
      ref={strip}
      className={s.bar}
      mark={coordinatorSigned.mark}
      asides={recent}
      older={older}
      current={open.kind === 'coordinator' ? null : open.taskId}
      onPick={onPick}
      onNew={onNew}
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
  // What the person first asked, as its request or, started with +, its first message: when, and whether it quotes the coordinator.
  const first = model.snapshot?.items.find((item) => item.kind === 'user_message')
  const asked = task?.request ?? (first?.kind === 'user_message' ? first.content.text : null)
  const quoted = asked?.startsWith('> ') === true
  const askedAt = first?.createdAt ?? task?.startedAt ?? null
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
              {...(quoted ? { note: asidesText.quoting } : askedAt === null ? {} : { note: asidesText.asked(ago(askedAt)) })}
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
