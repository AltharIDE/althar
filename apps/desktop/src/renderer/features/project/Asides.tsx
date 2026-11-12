import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { BoardSnapshot, BoardTask, PlanStep } from '@althar/contracts'
import { type Aside, AsideMoves, AsideTabs, Button, Icon, IconButton, LinkButton } from '@althar/ui'

import { type Client, messageOf, newTaskId } from '../../data/client'
import { coordinatorSigned } from '../../shared/signed'
import { ago } from '../../shared/time'
import { TaskView } from '../task/TaskView'
import { useTask } from '../task/useTask'
import s from './Asides.module.css'

/*
 * Asides (docs/decisions/tasks.md, "Asides"): the project's chats, the tasks
 * on Scratch, as pills over the coordinator's conversation, each with an ×
 * that clears it. One open shows its own conversation in the coordinator's
 * place, with the composer every task has, its runs over it and its move to
 * the board (Make it a task). Clearing one and making one a task show at
 * once, the runtime catching up behind, and one it refuses comes back with a
 * line saying why (`useAsideMoves`). A new one
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
  clearFailed: (title: string, why: string) => `Couldn’t clear ${title}. ${why}`,
  taskFailed: (title: string, why: string) => `Couldn’t make ${title} a task. ${why}`,
  startFailed: (why: string) => `Couldn’t start the aside. ${why}`,
  dismiss: 'Dismiss',
}

/** An aside the person moved, before the board says so: cleared, or made a task. */
type Move = 'clear' | 'task'

/** How long a move the runtime took waits for the board to say so, before the board is believed again. */
const BELIEVED = 10_000

/**
 * The person's moves on asides, shown at once (UI is instant): one cleared is gone from the board's tasks, one made a task is
 * on the board as work, from the press until the board's own read says so. One the runtime refused comes back, and `failed`
 * says why. `over` is the board as the person sees it, which the lanes, the pills and the flights are drawn from.
 */
export function useAsideMoves(client: Client, board: BoardSnapshot | null) {
  const [moves, setMoves] = useState<ReadonlyMap<string, Move>>(new Map())
  const [failed, setFailed] = useState<string | null>(null)
  const drop = (taskId: string) =>
    setMoves((now) => {
      if (!now.has(taskId)) return now
      const next = new Map(now)
      next.delete(taskId)
      return next
    })
  // Each move the board says now is the board's again: a cleared one settled, or gone; one made a task off Scratch.
  const agreed =
    board === null
      ? []
      : [...moves.keys()].filter((taskId) => {
          const task = board.tasks.find((one) => one.taskId === taskId)
          return task === undefined || task.scratch !== true || task.phase === 'settled'
        })
  if (agreed.length > 0) setMoves((now) => new Map([...now].filter(([taskId]) => !agreed.includes(taskId))))
  const over = useMemo(
    (): BoardSnapshot | null =>
      board === null || moves.size === 0
        ? board
        : {
            ...board,
            tasks: board.tasks.flatMap((task): ReadonlyArray<BoardTask> => {
              const move = moves.get(task.taskId)
              if (move === undefined) return [task]
              if (move === 'clear') return []
              const { scratch: _, ...work } = task
              return [work]
            }),
          },
    [board, moves],
  )
  const act = (move: Move, tasks: ReadonlyArray<BoardTask>) => {
    if (tasks.length === 0) return
    setFailed(null)
    setMoves((now) => new Map([...now, ...tasks.map((task) => [task.taskId, move] as const)]))
    for (const task of tasks) {
      const title = task.title === '' ? 'the aside' : `“${task.title}”`
      void (move === 'clear' ? client.markTaskDone(task.taskId) : client.shelveTask(task.taskId, null)).then(
        () => setTimeout(() => drop(task.taskId), BELIEVED),
        (error: unknown) => {
          drop(task.taskId)
          setFailed((move === 'clear' ? asidesText.clearFailed : asidesText.taskFailed)(title, messageOf(error)))
        },
      )
    }
  }
  return {
    over,
    /** The asides being moved, by id. */
    moving: moves as ReadonlyMap<string, unknown>,
    clear: (tasks: ReadonlyArray<BoardTask>) => act('clear', tasks),
    makeTask: (task: BoardTask) => act('task', [task]),
    failed,
    /** Says why an aside's own start didn't go through, as a move's failure is said. */
    startFailed: (error: unknown) => setFailed(asidesText.startFailed(messageOf(error))),
    dismiss: () => setFailed(null),
  }
}

export type AsideMoveState = ReturnType<typeof useAsideMoves>

/** Why a move on an aside didn't go through, where the person is: over the composer, with a way to dismiss it. */
export function AsideMoveFailed({ moves, className }: { moves: AsideMoveState; className?: string }) {
  if (moves.failed === null) return null
  return (
    <div className={className} role="alert">
      {moves.failed} <LinkButton onClick={moves.dismiss}>{asidesText.dismiss}</LinkButton>
    </div>
  )
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

/** Whether two leads are the same agent, model and effort. */
const sameLead = (a: PlanStep, b: PlanStep) => a.agentId === b.agentId && a.model === b.model && (a.effort ?? null) === (b.effort ?? null)

/**
 * Which conversation the coordinator's pane shows, and the starting of new asides: + starts one at once (`StartTask` with
 * `chat`), on the lead the composer has picked, by an id made here, so it is one pill from that moment, and its worktree and
 * lead get ready while the person writes. One opened and left unsaid is opened again by the next +, rather than another. The
 * person's first words go to its thread, under what it quotes, and name it, on the lead the composer has picked as they are
 * sent. Clearing one, or making it a task, gives the pane back to the coordinator at once (`useAsideMoves`).
 */
export function useAsides({
  client,
  projectId,
  lead,
  scratch,
  tasks,
  moves,
}: {
  client: Client
  projectId: string | null
  /** Who leads a new one: the composer's pick. */
  lead: PlanStep | null
  scratch: ReadonlyArray<BoardTask>
  /** Every task on the board, as the person's moves leave it, to tell one that left Scratch. */
  tasks: ReadonlyArray<BoardTask>
  moves: AsideMoveState
}) {
  const [opened, setOpened] = useState<AsideOpen>(COORDINATOR)
  // The one whose first words just went from here: first among the pills until the board has its first exchange.
  const [sent, setSent] = useState<string | null>(null)
  // Each one started here, as its start lands: its thread, or null where it couldn't start; and the lead it started on.
  const starts = useRef(new Map<string, Promise<string | null>>())
  const leads = useRef(new Map<string, PlanStep>())
  const task = opened.kind === 'coordinator' ? undefined : tasks.find((one) => one.taskId === opened.taskId)
  // One that left Scratch, for the board or cleared, gives the pane back to the coordinator.
  const open: AsideOpen = task !== undefined && (task.scratch !== true || task.phase === 'settled') ? COORDINATOR : opened
  // The one just sent keeps its place until the board has its first exchange, or it leaves Scratch: cleared, or made work. Then
  // it is let go, for good: the board's reads never bring back a pill for it.
  const sentTask = sent === null ? undefined : tasks.find((one) => one.taskId === sent)
  const sentDone =
    sent !== null &&
    (moves.moving.has(sent) ||
      (sentTask !== undefined && (sentTask.scratch !== true || sentTask.phase === 'settled' || sentTask.latest !== undefined)))
  if (sentDone) setSent(null)
  const first = open.kind === 'new' ? open.taskId : sent !== null && !sentDone ? sent : null

  const start = (taskId: string, quote: string | null) => {
    if (projectId === null || lead === null) return
    setOpened({ kind: 'new', taskId, threadId: null, quote })
    leads.current.set(taskId, lead)
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

  /** Words to a thread whose lead was `was`, on the lead picked now: another agent takes the thread, another model or effort it. */
  const sendOn = async (threadId: string, body: string, was: PlanStep | undefined) => {
    if (lead === null || was === undefined || sameLead(was, lead))
      return await client.send({ threadId, body, disposition: 'after_current' })
    if (was.agentId !== lead.agentId)
      return void (await client.switchAgent({
        threadId,
        agentId: lead.agentId,
        ...(lead.model === null ? {} : { model: lead.model }),
        ...(lead.effort == null ? {} : { effort: lead.effort }),
        body,
      }))
    if (lead.model !== null && lead.model !== was.model) await client.setModel({ threadId, model: lead.model })
    if (lead.effort != null && lead.effort !== was.effort) await client.setEffort({ threadId, effort: lead.effort })
    await client.send({ threadId, body, disposition: 'after_current' })
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
    // On the lead the composer has picked now: where it changed since +, the words go to that one, as a task's composer hands over.
    const was =
      leads.current.get(taskId) ?? scratch.find((one) => one.taskId === taskId)?.plan?.steps.find((step) => step.key === 'implement')
    await Promise.all([client.renameTask(taskId, asideTitle(words)).catch(() => undefined), sendOn(threadId, said, was)])
    leads.current.set(taskId, lead)
    setSent(taskId)
    setOpened((current) => (current.kind === 'new' && current.taskId === taskId ? { kind: 'aside', taskId, threadId } : current))
    return true
  }

  /**
   * Clears asides, by their ×s or "N older": they leave the pills at once, and the pane goes back to the coordinator where one
   * was open. A new one, nothing said in it, is only closed: it waits, ready, for the next +.
   */
  const clear = (taskIds: ReadonlyArray<string>) => {
    if (open.kind !== 'coordinator' && taskIds.includes(open.taskId)) setOpened(COORDINATOR)
    moves.clear(scratch.filter((one) => taskIds.includes(one.taskId) && one.unsaid !== true))
  }

  /** Make it a task: it flies to the board at once, as work, and the pane goes back to the coordinator. */
  const makeTask = (taskId: string) => {
    const one = scratch.find((candidate) => candidate.taskId === taskId)
    if (one === undefined) return
    if (open.kind !== 'coordinator' && open.taskId === taskId) setOpened(COORDINATOR)
    moves.makeTask(one)
  }

  return {
    open,
    first,
    begin,
    pick,
    say,
    clear,
    makeTask,
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
  /** Clears asides, by a pill's × or "N older": they leave the pills at once, and ⌘K still finds them. */
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
      onClear={(taskId) => onClear([taskId])}
      onClearOlder={onClear}
    />
  )
}

/**
 * An aside that left Scratch for the board flies from its pill to its card
 * there, or to the Board tab with the board closed; one cleared just goes.
 */
function useFlights(strip: RefObject<HTMLDivElement | null>, scratch: ReadonlyArray<BoardTask>, board: ReadonlyArray<BoardTask>) {
  // Where each pill was, last drawn, and the pill: once it leaves, it is gone from the page, and only then copied to fly.
  const rects = useRef(new Map<string, { rect: DOMRect; node: HTMLElement }>())
  const was = useRef<ReadonlySet<string>>(new Set(scratch.map((task) => task.taskId)))
  useLayoutEffect(() => {
    const ids = new Set(scratch.map((task) => task.taskId))
    for (const id of was.current) {
      if (ids.has(id)) continue
      const left = board.find((task) => task.taskId === id)
      const from = rects.current.get(id)
      if (left === undefined || left.scratch === true || left.phase === 'settled' || from === undefined) continue
      fly(from.node.cloneNode(true) as HTMLElement, from.rect, id)
    }
    was.current = ids
    rects.current = new Map(
      [...(strip.current?.querySelectorAll<HTMLElement>('[data-aside]') ?? [])].map((node) => [
        node.dataset.aside ?? '',
        { rect: node.getBoundingClientRect(), node },
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

/**
 * An aside open in the coordinator's place: its conversation and composer, as on its own screen, with its move to the board over
 * the composer, and why a move on an aside failed over it.
 */
export function AsideConversation({
  threadId,
  onBack,
  onOpenTask,
  onMakeTask,
  failed,
}: {
  threadId: string
  onBack: () => void
  onOpenTask: (threadId: string) => void
  /** Make it a task: it leaves for the board at once (`useAsides`). */
  onMakeTask: (taskId: string) => void
  /** Why the person's last move on an aside failed, over the composer; null for none. */
  failed: ReactNode
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
              onMakeTask={() => onMakeTask(task.id)}
              {...(quoted ? { note: asidesText.quoting } : askedAt === null ? {} : { note: asidesText.asked(ago(askedAt)) })}
            />
          ),
        notice: failed,
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
