import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import type { ThreadItem } from '@althar/contracts'
import {
  Button,
  Composer,
  HalftoneMark,
  Icon,
  IconButton,
  LinkButton,
  Menu,
  MenuItem,
  ProjectMark,
  Thread,
  ThreadShellProvider,
} from '@althar/ui'

import { kitInk } from '../../src/renderer/shared/inks'
import { ago } from '../../src/renderer/shared/time'
import { blocksOf } from '../../src/renderer/shared/thread'
import { ThreadBlocks } from '../../src/renderer/shared/ThreadBlocks'
import { Card, type CardActions } from '../../src/renderer/features/project/Card'
import { agents, card, items, project } from '../../tests/fixtures'
import { type Chat, isOld } from './data'
import { type MarkKind, useLab } from './lab'
import k from './kit.module.css'
import s from './asides.module.css'

/*
 * Asides (direction C, the one picked): quick conversations beside the
 * coordinator's, with its tools, in tabs over the conversation. The
 * conversation says who it is with up top, Coordinator, and signs its turns
 * so, in one of a few marks (keys 6–9). An aside's agent can decide it is
 * work: it says so, makes it a task, and the task flies to the board while
 * the aside's tab closes. Text the coordinator said, selected, starts an
 * aside about it.
 */

// ——— What the asides have open, and what was said in each ———

interface AsideUi {
  readonly chat: string | null
  /** A new aside being started, with what it quotes, if anything. */
  readonly starting: { readonly quote: string | null } | null
  /** Tabs closing, after their aside became a task. */
  readonly leaving: ReadonlySet<string>
}
let ui: AsideUi = { chat: null, starting: null, leaving: new Set() }
const said = new Map<string, ReadonlyArray<ThreadItem>>()
const working = new Set<string>()
const listeners = new Set<() => void>()
const emit = () => {
  for (const listen of listeners) listen()
}
const setUi = (next: Partial<AsideUi>) => {
  ui = { ...ui, ...next }
  emit()
}
const subscribe = (listen: () => void) => {
  listeners.add(listen)
  return () => listeners.delete(listen)
}
const useUi = () => useSyncExternalStore(subscribe, () => ui)
const add = (id: string, ...more: ReadonlyArray<ThreadItem>) => {
  said.set(id, [...(said.get(id) ?? []), ...more])
  ui = { ...ui }
  emit()
}

export const resetAsides = () => {
  said.clear()
  working.clear()
  ui = { chat: null, starting: null, leaving: new Set() }
  emit()
}

/** What an aside said before the lab opened: its question, the answer, and the person's last word where it was theirs. */
const before = (chat: Chat): ReadonlyArray<ThreadItem> =>
  chat.minutes === 0
    ? []
    : [
        items.you(chat.title),
        items.says(chat.by === 'lead' ? chat.said : 'A few that read well: Refund ledger, Refunds export, Money back.'),
        ...(chat.by === 'person' ? [items.you(chat.said)] : []),
      ]

/** Words that ask for work, rather than an answer. */
const ASKS_WORK = /\b(fix|change|make|build|do it|go ahead|task|implement|ship|write)\b/i

// ——— Who the conversation is with ———

/** The coordinator's mark, in the kind the lab shows. */
export function CoordinatorMark({ kind, size = 14 }: { kind: MarkKind; size?: number }) {
  switch (kind) {
    case 'althar':
      return <HalftoneMark size={size + 2} rise={false} className={s.mark} />
    case 'project':
      return <ProjectMark seed="p1" ink={kitInk(project.ink)} size={size} className={s.mark} />
    case 'glyph':
      return (
        <span className={s.glyph} style={{ width: size + 4, height: size + 4 }}>
          <Icon name="agents" size={size - 2} />
        </span>
      )
    case 'word':
      return null
  }
}

/** Every turn in the conversation, the asides' too, signed Coordinator instead of a model. */
function Signatures({ kind, root }: { kind: MarkKind; root: HTMLElement }) {
  const [heads, setHeads] = useState<ReadonlyArray<HTMLElement>>([])
  useLayoutEffect(() => {
    const look = () => {
      const found = [...root.querySelectorAll<HTMLElement>('article[class*="Turn-module__turn"] > header[class*="Turn-module__head"]')]
      setHeads((was) => (was.length === found.length && was.every((one, at) => one === found[at]) ? was : found))
    }
    look()
    const watch = new MutationObserver(look)
    watch.observe(root, { childList: true, subtree: true })
    return () => watch.disconnect()
  }, [root])
  return heads.map((head, at) =>
    createPortal(
      <span className={s.sign} data-sign>
        <CoordinatorMark kind={kind} size={13} />
        Coordinator
      </span>,
      head,
      `sign-${at}`,
    ),
  )
}

// ——— The task flying to the board ———

const fly = (from: HTMLElement, to: DOMRect, landed: () => void) => {
  const start = from.getBoundingClientRect()
  const ghost = from.cloneNode(true) as HTMLElement
  ghost.classList.add(s.ghost!)
  Object.assign(ghost.style, { left: `${start.left}px`, top: `${start.top}px`, width: `${start.width}px`, height: `${start.height}px` })
  document.body.append(ghost)
  from.style.visibility = 'hidden'
  const scale = Math.min(1, to.width / start.width)
  const dx = to.left - start.left
  const dy = to.top - start.top
  const flight = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 60}px) scale(${(1 + scale) / 2})`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.6, offset: 1 },
    ],
    { duration: 850, easing: 'cubic-bezier(0.5, 0, 0.2, 1)', fill: 'forwards' },
  )
  void flight.finished.then(() => {
    ghost.remove()
    landed()
  })
}

/** Where a task lands: Up next's first place, or, with the board closed, the Board tab of the header. */
const landing = (): { rect: DOMRect; board: boolean } | null => {
  const column = document.querySelector<HTMLElement>('[data-screen] [class*="Board-module__column"]')
  if (column !== null) {
    // After what is up next already: where a plan on a later countdown goes.
    const body = column.querySelector('[class*="Board-module__body"]')
    const last =
      body?.lastElementChild?.getBoundingClientRect() ?? column.firstElementChild?.getBoundingClientRect() ?? column.getBoundingClientRect()
    const rect = column.getBoundingClientRect()
    return { rect: new DOMRect(rect.left + 12, last.bottom + 6, rect.width - 24, 70), board: true }
  }
  const tab = [...document.querySelectorAll<HTMLElement>('[class*="ProjectHeader-module__bar"] [role="radio"]')].find(
    (one) => one.textContent?.trim() === 'Board',
  )
  return tab === undefined ? null : { rect: tab.getBoundingClientRect(), board: false }
}

/** Marks the card that just arrived on the board, or the Board tab, for a moment. */
const arrive = (title: string, board: boolean) => {
  const mark = (element: Element | null | undefined) => {
    if (element == null) return
    element.setAttribute('data-arrived', '')
    setTimeout(() => element.removeAttribute('data-arrived'), 1600)
  }
  if (!board) {
    mark(
      [...document.querySelectorAll('[class*="ProjectHeader-module__bar"] [role="radio"]')].find(
        (one) => one.textContent?.trim() === 'Board',
      ),
    )
    return
  }
  let tries = 0
  const find = () => {
    const title_ = [...document.querySelectorAll('[data-screen] [class*="Board-module__column"] [class*="cardTitle"]')].find((one) =>
      one.textContent?.includes(title),
    )
    const found = title_?.closest('article, li, [class*="Board-module__row"]') ?? title_?.parentElement
    if (found !== undefined) mark(found)
    else if (tries++ < 30) setTimeout(find, 60)
  }
  find()
}

// ——— An aside open in place ———

/** A task card in an aside, as the conversation's: its buttons do nothing here. */
const nothing = () => undefined
const cardActions: CardActions = {
  project: 'meridian',
  projectId: 'p1',
  agents,
  agentName: (id) => (id === 'codex' ? 'Codex' : 'Claude Code'),
  onStart: nothing,
  onHold: nothing,
  onChange: nothing,
  onCreateBranch: nothing,
  onOpen: nothing,
  onStopBackground: nothing,
}

function AsideFace({ chat, onWork }: { chat: Chat; onWork: (chat: Chat, from: HTMLElement | null) => void }) {
  const lab = useLab()
  useUi()
  const [value, setValue] = useState('')
  const face = useRef<HTMLDivElement>(null)
  const thread = [...before(chat), ...(said.get(chat.id) ?? [])]
  const busy = working.has(chat.id)
  const blocks = useMemo(
    () => blocksOf({ items: thread, turnRunning: busy, turnStarted: null, turnEnded: null, worktree: null }, new Map(), (iso) => ago(iso)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [thread.length, busy],
  )
  // The thread follows what is said.
  useEffect(() => {
    const scroller = face.current?.querySelector('[data-scroll]')
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }, [thread.length])
  const reply = (text: string) => {
    add(chat.id, items.you(text))
    working.add(chat.id)
    setTimeout(() => {
      working.delete(chat.id)
      if (ASKS_WORK.test(text) || ASKS_WORK.test(chat.title)) {
        add(
          chat.id,
          items.says('That’s a change, not a chat: the queue’s wait goes, and its test with it. I’ve made it a task; it’s on the board.'),
          items.card(
            card({
              taskId: chat.id,
              threadId: `th-${chat.id}`,
              title: titleOf(chat),
              slug: chat.id,
              plan: { ...card().plan!, startsAt: new Date(Date.now() + 60_000).toISOString() },
            }),
          ),
        )
        // A beat to read it, then it goes.
        setTimeout(() => onWork(chat, face.current?.querySelector<HTMLElement>('[class*="TaskLaunch-module__launch"]') ?? null), 1100)
      } else add(chat.id, items.says('Good question. In short: yes, and it’s in payments/client.ts if you want to look.'))
    }, 900)
  }
  return (
    <div className={k.face} ref={face}>
      <div className={k.head}>
        <span className={k.headTitle}>{chat.title}</span>
        {!lab.promoted.has(chat.id) && (
          <>
            <Button size="small" icon="work" onClick={() => onWork(chat, face.current?.querySelector<HTMLElement>(`.${k.head}`) ?? null)}>
              Make it a task
            </Button>
            <LinkButton
              title="It leaves the tabs; ⌘K still finds it"
              onClick={() => {
                lab.clear([chat.id])
                setUi({ chat: null })
              }}
            >
              Clear
            </LinkButton>
          </>
        )}
      </div>
      <div className={k.thread} data-scroll>
        <Thread label={chat.title}>
          <ThreadShellProvider value={{}}>
            <ThreadBlocks
              blocks={blocks}
              card={(one) => <Card card={one} actions={cardActions} />}
              threadId={`aside-${chat.id}`}
              session={{ agentId: 'claude-code', model: 'sonnet', account: null }}
            />
          </ThreadShellProvider>
        </Thread>
      </div>
      <div className={k.composer}>
        <Composer
          value={value}
          onChange={setValue}
          placeholder="Reply"
          busy={busy}
          onSubmit={(text) => {
            if (text.trim() === '') return
            setValue('')
            reply(text.trim())
          }}
        />
      </div>
    </div>
  )
}

/** A task's title from an aside's question: what it asked, as work. */
const titleOf = (chat: Chat) =>
  chat.title.startsWith('Why does the retry') ? 'Retry backs off only in the client' : chat.title.replace(/\?$/, '')

/** A new aside: what it quotes, if anything, and the composer that starts it. */
function Starting({ quote }: { quote: string | null }) {
  const lab = useLab()
  const [value, setValue] = useState('')
  return (
    <div className={s.starting}>
      <Composer
        value={value}
        onChange={setValue}
        placeholder={quote === null ? 'Ask something on the side' : 'Ask about this, on the side'}
        {...(quote === null
          ? {}
          : {
              above: (
                <div className={s.quote}>
                  <Icon name="quote" size={12} />
                  <span className={s.quoteText}>{quote}</span>
                  <IconButton icon="close" size="small" label="Drop the quote" onClick={() => setUi({ starting: { quote: null } })} />
                </div>
              ),
            })}
        onSubmit={(text) => {
          if (text.trim() === '') return
          const chat = lab.start(text.trim())
          said.set(chat.id, [items.you(quote === null ? text.trim() : `“${quote}”\n\n${text.trim()}`)])
          working.add(chat.id)
          setUi({ chat: chat.id, starting: null })
          setTimeout(() => {
            working.delete(chat.id)
            add(
              chat.id,
              items.says(
                quote === null
                  ? 'Here’s the short of it: payments/client.ts holds it, and nothing else reads it.'
                  : 'Picking up from what the coordinator said: the queue’s wait is the second back-off, and the one to drop. The client’s alone is enough for Stripe’s outages.',
              ),
            )
          }, 900)
        }}
      />
    </div>
  )
}

// ——— Text the coordinator said, selected: an aside about it ———

function AskFromSelection({ root }: { root: HTMLElement }) {
  const [at, setAt] = useState<{ x: number; y: number; text: string } | null>(null)
  useEffect(() => {
    const look = () => {
      const selection = document.getSelection()
      const text = selection?.toString().trim() ?? ''
      if (selection === null || selection.rangeCount === 0 || text === '') return setAt(null)
      const range = selection.getRangeAt(0)
      const node = range.commonAncestorContainer
      const element = node instanceof HTMLElement ? node : node.parentElement
      // Only what the coordinator said, in its own conversation, not in an aside open over it.
      const turn = element?.closest('article[class*="Turn-module__turn"]')
      if (turn == null || !root.contains(turn) || turn.closest('[data-aside]') !== null) return setAt(null)
      const rect = range.getBoundingClientRect()
      setAt({ x: rect.left + rect.width / 2, y: rect.top, text })
    }
    const up = () => setTimeout(look, 0)
    document.addEventListener('mouseup', up)
    document.addEventListener('keyup', up)
    const scroll = () => setAt(null)
    root.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('mouseup', up)
      document.removeEventListener('keyup', up)
      root.removeEventListener('scroll', scroll, true)
    }
  }, [root])
  if (at === null) return null
  return createPortal(
    <div className={s.ask} style={{ left: at.x, top: at.y }}>
      <Button
        size="small"
        icon="quote"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setUi({ chat: null, starting: { quote: at.text.length > 280 ? `${at.text.slice(0, 280)}…` : at.text } })
          document.getSelection()?.removeAllRanges()
          setAt(null)
        }}
      >
        Ask in an aside
      </Button>
    </div>,
    document.body,
  )
}

// ——— The tabs over the conversation ———

const useTalk = (deps: ReadonlyArray<unknown>) => {
  const [talk, setTalk] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const look = () => setTalk(document.querySelector<HTMLElement>('[data-screen] [class*="Project-module__talk"]'))
    look()
    const watch = new MutationObserver(look)
    watch.observe(document.body, { childList: true, subtree: true })
    return () => watch.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return talk
}

export function Asides({ mark }: { mark: MarkKind }) {
  const lab = useLab()
  const open = useUi()
  const talk = useTalk([lab.open, lab.visit, lab.room])
  // The lab reset, or another direction: nothing open.
  useEffect(() => resetAsides, [])
  if (talk === null || lab.open !== null) return null
  const shown = lab.chats.filter((chat) => !lab.promoted.has(chat.id) || open.leaving.has(chat.id))
  const recent = shown.filter((chat) => !isOld(chat))
  const old = shown.filter(isOld)
  const current = shown.find((chat) => chat.id === open.chat) ?? null
  const work = (chat: Chat, from: HTMLElement | null) => {
    const to = landing()
    const done = (board: boolean) => {
      lab.promote(chat.id)
      setUi({ leaving: new Set([...ui.leaving, chat.id]) })
      arrive(titleOf(chat), board)
      // The aside's tab closes, and the conversation is the coordinator's again.
      setTimeout(
        () => setUi({ chat: ui.chat === chat.id ? null : ui.chat, leaving: new Set([...ui.leaving].filter((id) => id !== chat.id)) }),
        420,
      )
    }
    if (from === null || to === null) return done(to?.board ?? false)
    fly(from, to.rect, () => done(to.board))
  }
  const tab = (chat: Chat): ReactNode => (
    <button
      key={chat.id}
      type="button"
      role="tab"
      aria-selected={current?.id === chat.id}
      className={s.chip}
      data-leaving={open.leaving.has(chat.id) || undefined}
      onClick={() => setUi({ chat: chat.id, starting: null })}
      title={chat.said}
    >
      {(chat.running === true || working.has(chat.id)) && <span className={s.live} />}
      <span className={s.chipTitle}>{chat.title}</span>
    </button>
  )
  return createPortal(
    <>
      <div className={s.strip}>
        <div className={s.tabs} role="tablist" aria-label="Conversations">
          <button
            type="button"
            role="tab"
            aria-selected={current === null && open.starting === null}
            className={`${s.chip} ${s.coordinator}`}
            onClick={() => setUi({ chat: null, starting: null })}
          >
            <CoordinatorMark kind={mark} />
            Coordinator
          </button>
          {recent.length > 0 && <span className={s.rule} aria-hidden />}
          {open.starting !== null && (
            <button type="button" role="tab" aria-selected className={s.chip}>
              <span className={s.chipTitle}>New aside</span>
            </button>
          )}
          {recent.map(tab)}
        </div>
        {old.length > 0 && (
          <Menu
            label="Older asides"
            trigger={
              <button type="button" className={s.chip}>
                {old.length} older
              </button>
            }
            note="Untouched for over a week. Cleared, they still come up in ⌘K."
          >
            {old.map((chat) => (
              <MenuItem key={chat.id} onSelect={() => setUi({ chat: chat.id, starting: null })}>
                {chat.title}
              </MenuItem>
            ))}
            <MenuItem onSelect={() => lab.clear(old.map((chat) => chat.id))}>Clear these {old.length}</MenuItem>
          </Menu>
        )}
        <IconButton icon="plus" size="small" label="New aside" kbd="⌘⇧N" onClick={() => setUi({ chat: null, starting: { quote: null } })} />
      </div>
      {current !== null && (
        <div className={s.inTalk} data-aside>
          <AsideFace key={current.id} chat={current} onWork={work} />
        </div>
      )}
      {open.starting !== null && (
        <div className={s.inTalk} data-aside>
          <Starting key={open.starting.quote ?? ''} quote={open.starting.quote} />
        </div>
      )}
      <Signatures kind={mark} root={talk} />
      <AskFromSelection root={talk} />
    </>,
    talk,
  )
}
