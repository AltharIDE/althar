import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import { ChromeButton, IconButton, Menu, MenuItem } from '@althar/ui'

import { type Chat, ELSEWHERE, isOld } from './data'
import { ChatFace, ChatRow, OldLine, StartBox, type Words } from './kit'
import type { DirectionOf } from './lab'
import { useLab } from './lab'
import k from './kit.module.css'
import s from './directions.module.css'

/*
 * The directions, each drawn into the real project window: what it puts in
 * the window's bar (Chrome), and what it lays over or into the screen
 * (Overlay), finding the screen's own parts by their class names.
 */

const CHATS: Words = { one: 'chat', many: 'chats' }
const ASIDES: Words = { one: 'aside', many: 'asides' }

// What a direction has open, shared by its bar button and its overlay.
let ui = { view: false, tray: false, chat: null as string | null }
const listeners = new Set<() => void>()
const setUi = (next: Partial<typeof ui>) => {
  ui = { ...ui, ...next }
  for (const listen of listeners) listen()
}
const useUi = () =>
  useSyncExternalStore(
    (listen) => {
      listeners.add(listen)
      return () => listeners.delete(listen)
    },
    () => ui,
  )

/** An element of the screen, found once it is drawn, and again as the lab changes. */
const useFound = (selector: string, deps: ReadonlyArray<unknown>) => {
  const [found, setFound] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    let frame = 0
    const look = () => {
      const element = document.querySelector<HTMLElement>(selector)
      setFound(element)
      if (element === null) frame = requestAnimationFrame(look)
    }
    look()
    const watch = new MutationObserver(() => setFound(document.querySelector<HTMLElement>(selector)))
    watch.observe(document.body, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      watch.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return found
}

const Nothing = () => null

// ——— B: Chats, a view of the project's own ———

/** A face beside the project's views, after Artifacts. */
function ChatsTab() {
  const lab = useLab()
  const open = useUi()
  const group = useFound('[class*="ProjectHeader-module__bar"] [class*="Segmented-module__group"]', [lab.open, lab.visit])
  if (group === null || lab.open !== null) return null
  return createPortal(
    <button type="button" className={s.tab} aria-pressed={open.view} onClick={() => setUi({ view: !open.view })} title="Chats  ⌘6">
      Chats <span className={s.count}>{lab.chats.length}</span>
    </button>,
    group.parentElement!,
  )
}

function ChatsView() {
  const lab = useLab()
  const open = useUi()
  const header = useFound('[class*="ProjectHeader-module__bar"]', [lab.open, lab.visit])
  // Another face of the project chosen: Chats gives way.
  useEffect(() => {
    if (header === null) return
    const away = (event: Event) => {
      if ((event.target as HTMLElement).closest('[role="radio"]') !== null) setUi({ view: false })
    }
    header.addEventListener('click', away)
    return () => header.removeEventListener('click', away)
  }, [header])
  if (!open.view || lab.open !== null || header === null) return null
  const top = header.getBoundingClientRect().bottom - header.closest('[data-screen]')!.getBoundingClientRect().top
  return (
    <div className={s.view} style={{ top }} data-chats-view>
      <div className={s.column}>
        <StartBox placeholder="Start a chat about meridian" onStarted={(chat) => lab.openTask(`th-${chat.id}`)} />
        <h2 className={s.heading}>Chats</h2>
        <ul className={k.list} aria-label="Chats">
          {lab.chats.map((chat) => (
            <ChatRow key={chat.id} chat={chat} words={CHATS} onOpen={() => lab.openTask(`th-${chat.id}`)} />
          ))}
        </ul>
        <OldLine chats={lab.chats} words={CHATS} />
      </div>
    </div>
  )
}

function B() {
  return (
    <>
      <ChatsTab />
      <ChatsView />
    </>
  )
}

// ——— C: Asides, beside the coordinator in the conversation ———

function Asides() {
  const lab = useLab()
  const open = useUi()
  const talk = useFound('[class*="Project-module__talk"]', [lab.open, lab.visit, lab.room])
  if (talk === null || lab.open !== null) return null
  const recent = lab.chats.filter((chat) => !isOld(chat))
  const old = lab.chats.filter(isOld)
  const current = lab.chats.find((chat) => chat.id === open.chat) ?? null
  const starting = open.chat === 'new'
  return createPortal(
    <>
      <div className={s.strip}>
        <div className={s.tabs} role="tablist" aria-label="Asides">
          <button
            type="button"
            role="tab"
            aria-selected={current === null && !starting}
            className={s.chip}
            onClick={() => setUi({ chat: null })}
          >
            Coordinator
          </button>
          {recent.map((chat) => (
            <button
              key={chat.id}
              type="button"
              role="tab"
              aria-selected={current?.id === chat.id}
              className={s.chip}
              onClick={() => setUi({ chat: chat.id })}
              title={chat.said}
            >
              {chat.running === true && <span className={s.live} />}
              <span className={s.chipTitle}>{chat.title}</span>
            </button>
          ))}
        </div>
        {old.length > 0 && (
          <Menu
            label="Older asides"
            trigger={
              <button type="button" className={s.chip}>
                {old.length} older
              </button>
            }
            note={`Untouched for over a week. Cleared, they still come up in ⌘K.`}
          >
            {old.map((chat) => (
              <MenuItem key={chat.id} onSelect={() => setUi({ chat: chat.id })}>
                {chat.title}
              </MenuItem>
            ))}
            <MenuItem onSelect={() => lab.clear(old.map((chat) => chat.id))}>Clear these {old.length}</MenuItem>
          </Menu>
        )}
        <IconButton icon="plus" size="small" label="New aside" kbd="⌘⇧N" onClick={() => setUi({ chat: 'new' })} />
      </div>
      {current !== null && (
        <div className={s.inTalk}>
          <ChatFace key={current.id} chat={current} words={ASIDES} onDone={() => setUi({ chat: null })} />
        </div>
      )}
      {starting && (
        <div className={s.inTalk}>
          <div className={s.starting}>
            <p className={s.lead}>
              An aside is a quick question to an agent of its own, beside the coordinator: nothing is planned, and the board stays as it is.
            </p>
            <StartBox placeholder="Ask something on the side" onStarted={(chat) => setUi({ chat: chat.id })} />
          </div>
        </div>
      )}
    </>,
    talk,
  )
}

/** With the conversation closed, the asides have nowhere to be: the board says how many, and opens the conversation on them. */
function C() {
  return <Asides />
}

// ——— D: Chats, a tray over any screen, across projects ———

function TrayButton() {
  const lab = useLab()
  const open = useUi()
  const count = lab.chats.length + ELSEWHERE.length
  return (
    <ChromeButton icon="comment" label="Chats" count={count} kbd="⌘J" expanded={open.tray} onClick={() => setUi({ tray: !open.tray })} />
  )
}

function Tray() {
  const lab = useLab()
  const open = useUi()
  const [project, setProject] = useState('meridian')
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'j' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setUi({ tray: !ui.tray })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (!open.tray) return null
  const all: ReadonlyArray<Chat> = [...lab.chats, ...ELSEWHERE]
  const current = all.find((chat) => chat.id === open.chat) ?? null
  return (
    <div className={s.tray}>
      {current === null ? (
        <section className={s.trayList} aria-label="Chats">
          <div className={s.trayHead}>
            <strong>Chats</strong>
            <IconButton icon="close" size="small" label="Close" kbd="⌘J" onClick={() => setUi({ tray: false })} />
          </div>
          <div className={s.trayBody}>
            <StartBox
              className={s.trayStart}
              placeholder="Ask anything"
              picker={
                <Menu
                  label="About"
                  trigger={
                    <button type="button" className={s.about}>
                      {project} ▾
                    </button>
                  }
                >
                  {['meridian', 'site', 'infra', 'No project'].map((one) => (
                    <MenuItem key={one} onSelect={() => setProject(one)}>
                      {one}
                    </MenuItem>
                  ))}
                </Menu>
              }
              onStarted={(chat) => setUi({ chat: chat.id })}
            />
            <h3 className={s.group}>meridian</h3>
            <ul className={k.list}>
              {lab.chats.map((chat) => (
                <ChatRow key={chat.id} chat={chat} words={CHATS} onOpen={() => setUi({ chat: chat.id })} />
              ))}
            </ul>
            <h3 className={s.group}>Other projects</h3>
            <ul className={k.list}>
              {ELSEWHERE.map((chat) => (
                <ChatRow key={chat.id} chat={chat} words={CHATS} project onOpen={() => setUi({ chat: chat.id })} />
              ))}
            </ul>
            <OldLine chats={lab.chats} words={CHATS} />
          </div>
        </section>
      ) : (
        <ChatFace
          key={current.id}
          chat={current}
          words={CHATS}
          head={<IconButton icon="chevronL" size="small" label="All chats" onClick={() => setUi({ chat: null })} />}
          onDone={() => setUi({ chat: null })}
        />
      )}
    </div>
  )
}

// ——— E: no place: quiet in the conversation, and on the board only while at work ———

/** Quiets the chats where the screen draws them: their cards in the conversation, and on the board. */
function Quiet() {
  const lab = useLab()
  useEffect(() => {
    const titles = new Set(lab.chats.filter((chat) => !lab.promoted.has(chat.id)).map((chat) => chat.title))
    const old = new Set(lab.chats.filter(isOld).map((chat) => chat.title))
    const mark = () => {
      for (const element of document.querySelectorAll<HTMLElement>(
        '[data-screen] [class*="TaskCard-module__title"], [data-screen] [class*="cardTitle"]',
      )) {
        const title = element.textContent?.trim() ?? ''
        const card = element.closest<HTMLElement>('article') ?? element
        if (!titles.has(title)) delete card.dataset.quiet
        else card.dataset.quiet = old.has(title) ? 'old' : 'chat'
      }
    }
    mark()
    const watch = new MutationObserver(mark)
    watch.observe(document.body, { childList: true, subtree: true })
    return () => watch.disconnect()
  }, [lab.chats, lab.promoted, lab.version])
  return null
}

export const DIRECTIONS: ReadonlyArray<DirectionOf> = [
  {
    key: 'A',
    label: 'Today',
    note: 'Today: a “Scratch · 5” chip at the head of Up next; the board alone shows it.',
    board: 'scratch',
    Chrome: Nothing,
    Overlay: Nothing,
  },
  {
    key: 'B',
    label: 'Chats view',
    note: 'Chats: a view of the project’s own, after Artifacts. Any layout.',
    board: 'none',
    Chrome: Nothing,
    Overlay: B,
  },
  {
    key: 'C',
    label: 'Asides in the conversation',
    note: 'Asides: tabs over the conversation, beside the coordinator. Needs the conversation open.',
    board: 'none',
    Chrome: Nothing,
    Overlay: C,
  },
  {
    key: 'D',
    label: 'Chats tray',
    note: 'Chats: a tray from the window’s bar (⌘J) over any screen, every project’s. Any layout.',
    board: 'none',
    Chrome: TrayButton,
    Overlay: Tray,
  },
  {
    key: 'E',
    label: 'No place',
    note: 'No place: chats stay in the conversation where they began, quiet, and on the board only while at work.',
    board: 'quiet',
    Chrome: Nothing,
    Overlay: Quiet,
    inThread: true,
  },
]

export function Overlay() {
  const lab = useLab()
  const Of = lab.direction.Overlay
  // A direction left behind closes what it had open.
  useEffect(() => setUi({ view: false, tray: false, chat: null }), [lab.direction.key])
  return <Of />
}
