import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'

import type { ThreadGoal } from '@althar/contracts'
import { type ComposerProps, Composer as Kit, Icon, IconButton, LinkButton } from '@althar/ui'

import { type Command, GOAL, goalShown, type Parsed, parse, statusOf, type Sub, type Surface } from './commands'
import { world } from './data'
import { type Direction, useLab } from './state'
import s from './slash.module.css'

/*
 * The composer with commands, in each direction: the kit's own Composer, as
 * every screen draws it, with what the slash brings drawn round it. The words
 * typed are still the draft, and what is sent is still the words TaskView
 * reads (`/goal …`), so the goal is set, changed, paused and cleared for real
 * through the task's own handling. Only what shows differs:
 *
 * A · Menu and token: a menu over the composer as "/" is typed; the command
 *     picked becomes a token at the start of the field, removed whole.
 * B · Command mode: the list opens inside the composer; picking /goal turns
 *     the composer into the goal's: its state and actions on a row of their
 *     own, the field its objective.
 * C · In the field: nothing opens. The best match is written ahead in grey,
 *     the command reads in cobalt, and the composer's own lower row lists the
 *     others and what the command takes.
 * D · Controls panel: a panel joined to the composer's top edge, each command
 *     with where it stands; /goal opens into the goal itself, with its turns,
 *     its last progress and what can be done to it.
 */

/** The composer this one is: its place, and its thread's id, which is its draft's. */
export const Where = createContext<{ readonly surface: Surface; readonly threadId: string } | null>(null)

const useGoal = (threadId: string) => useSyncExternalStore(world.onChange, () => world.goal(threadId))

type Shown = Exclude<Direction, 'today'>

export function SlashComposer(props: ComposerProps) {
  const { d } = useLab()
  const where = useContext(Where)
  if (d === 'today' || where === null) return <Kit {...props} />
  return <Slash key={d} d={d} surface={where.surface} threadId={where.threadId} {...props} />
}

type Row = { readonly key: string; readonly command: Command } | { readonly key: string; readonly sub: Sub }

const rowsOf = (parsed: Parsed): ReadonlyArray<Row> => {
  if (parsed.kind === 'finding') return parsed.matches.map((command) => ({ key: `${command.name}:${command.does}`, command }))
  if (parsed.kind === 'command') return parsed.subs.map((sub) => ({ key: sub.name, sub }))
  return []
}

/** What the field is turned into in B: the goal's own composer, its objective written fresh or the current one edited. */
interface Mode {
  readonly editing: boolean
}

function Slash({ d, surface, threadId, ...props }: ComposerProps & { d: Shown; surface: Surface; threadId: string }) {
  const { more } = useLab()
  const goal = useGoal(threadId)
  const own = useRef<HTMLTextAreaElement>(null)
  const ref = props.inputRef ?? own
  const { value, onChange } = props
  const [mode, setMode] = useState<Mode | null>(null)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const parsed: Parsed = mode === null ? parse(value, surface, more, goal) : { kind: 'none' }
  const rows = rowsOf(parsed)
  const open = rows.length > 0 && dismissed !== value
  const at = Math.min(active, Math.max(0, rows.length - 1))
  const listKey = rows.map((row) => row.key).join(' ')
  useLayoutEffect(() => setActive(0), [listKey])
  useEffect(() => setNote(null), [value])

  // The goal said in the composer itself (B's mode, D's panel): its own line over the composer steps aside meanwhile.
  const goalHere = goal !== null && (mode !== null || (d === 'd' && parsed.kind === 'command' && parsed.command === GOAL))
  useEffect(() => {
    goalShown.set(goalHere)
    return () => goalShown.set(false)
  }, [goalHere])

  const caretToEnd = () =>
    requestAnimationFrame(() => {
      const field = ref.current
      if (field === null) return
      field.focus()
      field.setSelectionRange(field.value.length, field.value.length)
    })

  const send = (words: string) => props.onSubmit(words)

  const take = (row: Row | undefined, sending: boolean) => {
    if (row === undefined) return
    if ('command' in row) {
      if (d === 'b' && row.command === GOAL) {
        setMode({ editing: false })
        onChange('')
      } else onChange(`/${row.command.name} `)
      caretToEnd()
      return
    }
    const { sub } = row
    if (sub.name === 'edit') {
      onChange(`/goal edit ${goal?.objective ?? ''}`)
      caretToEnd()
      return
    }
    if (sending) send(`/goal ${sub.name}`)
    else {
      onChange(`/goal ${sub.name}`)
      caretToEnd()
    }
  }

  const leave = () => {
    setMode(null)
    onChange('')
    caretToEnd()
  }

  const sendMode = () => {
    if (mode === null) return
    const objective = value.trim()
    if (objective === '') return
    send(mode.editing ? `/goal edit ${objective}` : `/goal ${objective}`)
    setMode(null)
  }

  /** What the send button and Enter send, once nothing is open to pick from. */
  const submit = (text: string) => {
    if (mode !== null) return sendMode()
    if (parsed.kind === 'command') {
      if (parsed.intent.action === 'nothing') return
      if (parsed.intent.action === 'sample') {
        setNote(`/${parsed.command.name} is one of the commands to come. Only /goal works here.`)
        return
      }
    }
    send(text)
  }

  // The field's keys, ahead of the kit's own: while something is open to pick from, the arrows, Tab, Enter and Escape are its.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {})
  keys.current = (event: KeyboardEvent) => {
    if (event.isComposing) return
    const stop = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    const plain = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
    if (mode !== null) {
      if (event.key === 'Escape' || (event.key === 'Backspace' && value === '')) {
        stop()
        leave()
      } else if (event.key === 'Enter' && plain) {
        stop()
        sendMode()
      }
      return
    }
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        stop()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((at + step + rows.length) % rows.length)
        return
      }
      if (event.key === 'Tab' && !event.shiftKey) {
        stop()
        take(rows[at], false)
        return
      }
      if (event.key === 'Enter' && plain) {
        stop()
        take(rows[at], true)
        return
      }
      if (event.key === 'Escape') {
        stop()
        setDismissed(value)
        return
      }
    }
    if (parsed.kind === 'command') {
      const field = ref.current
      const atEnd = field !== null && field.selectionStart === value.length && field.selectionEnd === value.length
      // A's token goes whole.
      if (d === 'a' && event.key === 'Backspace' && atEnd && value === `/${parsed.command.name} `) {
        stop()
        onChange('')
        return
      }
      if (event.key === 'Enter' && plain && (parsed.intent.action === 'nothing' || parsed.intent.action === 'sample')) {
        stop()
        submit(value)
      }
    }
  }
  useEffect(() => {
    const field = ref.current
    if (field === null) return
    const onKey = (event: KeyboardEvent) => keys.current(event)
    field.addEventListener('keydown', onKey)
    return () => field.removeEventListener('keydown', onKey)
  }, [ref])

  // The field is a combobox while there is something to pick from.
  const listId = `slash-${threadId}`
  useEffect(() => {
    const field = ref.current
    if (field === null) return
    if (open) {
      field.setAttribute('aria-autocomplete', 'list')
      field.setAttribute('aria-expanded', 'true')
      field.setAttribute('aria-controls', listId)
      field.setAttribute('aria-activedescendant', `${listId}-${at}`)
    } else for (const name of ['aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant']) field.removeAttribute(name)
  }, [open, at, listId, ref])

  const list = (variant: 'menu' | 'inside' | 'panel') => (
    <div id={listId} role="listbox" aria-label="Commands" className={s.list} data-variant={variant}>
      {rows.map((row, index) => (
        <div
          key={row.key}
          id={`${listId}-${index}`}
          role="option"
          aria-selected={index === at}
          className={s.row}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => {
            if (index !== at) setActive(index)
          }}
          onClick={() => take(row, true)}
        >
          <span className={s.tile}>
            <Icon name={'command' in row ? row.command.icon : row.sub.icon} size={13} />
          </span>
          <span className={s.name}>{'command' in row ? `/${row.command.name}` : row.sub.name}</span>
          <span className={s.does}>{'command' in row ? row.command.does : row.sub.does}</span>
          {'command' in row && row.command.now?.(goal) != null && <span className={s.now}>{row.command.now(goal)}</span>}
        </div>
      ))}
    </div>
  )

  // What a typed command says that no list does: where a goal lives, that this one is still to come.
  const lines: ReactNode[] = []
  if (parsed.kind === 'unknown' && parsed.elsewhere === 'task' && dismissed !== value)
    lines.push(<div key="elsewhere">Goals are set in a task’s conversation.</div>)
  if (note !== null) lines.push(<div key="note">{note}</div>)
  const notice =
    lines.length === 0 ? (
      props.notice
    ) : (
      <>
        {props.notice}
        {lines}
      </>
    )

  const typing = parsed.kind === 'command' ? parsed : null
  const replacing = typing?.command === GOAL && typing.intent.action === 'replace' && goal !== null

  // Each direction's own parts.
  let floating: ReactNode = null
  let inside: ReactNode = null
  let tray: ReactNode = props.tray
  let picker: ReactNode = props.picker

  if (d === 'a') {
    const head = typing?.command === GOAL && goal !== null && (open || replacing)
    floating =
      open || replacing ? (
        <div className={s.menu}>
          {head && <GoalHead goal={goal} replacing={replacing} />}
          {open && list('menu')}
        </div>
      ) : null
  }

  if (d === 'b') {
    inside =
      mode !== null ? (
        <ModeHead
          goal={goal}
          editing={mode.editing}
          onPause={() => send('/goal pause')}
          onResume={() => send('/goal resume')}
          onEdit={() => {
            setMode({ editing: true })
            onChange(goal?.objective ?? '')
            caretToEnd()
          }}
          onClear={() => {
            send('/goal clear')
            setMode(null)
          }}
          onLeave={leave}
        />
      ) : open ? (
        list('inside')
      ) : null
  }

  if (d === 'c' && parsed.kind !== 'none' && !(parsed.kind === 'unknown' && parsed.elsewhere === null)) {
    picker = <Strip parsed={parsed} rows={rows} at={at} goal={goal} onTake={(row) => take(row, false)} />
  }

  if (d === 'd' && (open || typing !== null)) {
    tray = (
      <div className={s.panel}>
        {typing?.command === GOAL ? (
          <GoalPanel goal={goal} intent={typing.intent.action} list={open ? list('panel') : null} onDo={() => submit(value)} />
        ) : typing !== null ? (
          <div className={s.panelHead}>
            <span className={s.name}>/{typing.command.name}</span>
            <span className={s.does}>{typing.command.does}</span>
          </div>
        ) : (
          list('panel')
        )}
      </div>
    )
  }

  const mirrored = mode === null && d !== 'b' && value.startsWith('/') && parsed.kind !== 'unknown'

  return (
    <div className={s.wrap} data-direction={d} data-mode={mode !== null || undefined}>
      {floating}
      <Kit
        {...props}
        value={value}
        onChange={(next) => {
          setDismissed(null)
          onChange(next)
        }}
        onSubmit={submit}
        notice={notice}
        tray={tray}
        picker={picker}
        placeholder={
          mode === null
            ? props.placeholder
            : mode.editing
              ? 'The objective'
              : goal === null
                ? 'What should the lead keep working toward?'
                : 'A new objective, in place of this one'
        }
        text={{
          ...props.text,
          ...(mode === null ? {} : { send: mode.editing ? 'Save the goal' : goal === null ? 'Set the goal' : 'Replace the goal' }),
        }}
      />
      {inside !== null && <Inside field={ref}>{inside}</Inside>}
      {mirrored && <Mirror field={ref} value={value} parsed={parsed} d={d} goal={goal} at={at} rows={rows} />}
    </div>
  )
}

/* -------------------------------------------------------------------------------------------------------------------- */

/** A: over the list, the goal it acts on; while a new objective is typed, the one it replaces. */
function GoalHead({ goal, replacing }: { goal: ThreadGoal; replacing: boolean }) {
  return (
    <div className={s.head}>
      <span className={s.headLabel}>{replacing ? 'Replaces' : 'Goal'}</span>
      <span className={s.headObjective} title={goal.objective}>
        {goal.objective}
      </span>
      <span className={s.now}>{statusOf(goal)}</span>
    </div>
  )
}

/** B: the composer as the goal's. Its state and what can be done to it on a row over the field; the field is its objective. */
function ModeHead({
  goal,
  editing,
  onPause,
  onResume,
  onEdit,
  onClear,
  onLeave,
}: {
  goal: ThreadGoal | null
  editing: boolean
  onPause: () => void
  onResume: () => void
  onEdit: () => void
  onClear: () => void
  onLeave: () => void
}) {
  return (
    <div className={s.mode}>
      <span className={s.modeName}>
        <Icon name={GOAL.icon} size={13} />
        Goal
      </span>
      <span className={s.modeFacts}>
        {goal === null ? (
          'Up to 12 turns on its own'
        ) : (
          <>
            <span className={s.modeStatus}>{statusOf(goal)}</span>
            {!editing && (
              <span className={s.modeObjective} title={goal.objective}>
                {goal.objective}
              </span>
            )}
          </>
        )}
      </span>
      {goal !== null && (
        <span className={s.modeActs}>
          {goal.status === 'active' ? (
            <LinkButton onClick={onPause}>Pause</LinkButton>
          ) : goal.status !== 'complete' ? (
            <LinkButton onClick={onResume}>Resume</LinkButton>
          ) : null}
          {!editing && <LinkButton onClick={onEdit}>Edit</LinkButton>}
          <LinkButton onClick={onClear}>Clear</LinkButton>
        </span>
      )}
      <IconButton icon="close" size="small" label="Leave the goal" onClick={onLeave} />
    </div>
  )
}

/** C: the composer's lower row, while a command is typed: the others it could be, or what the command takes. */
function Strip({
  parsed,
  rows,
  at,
  goal,
  onTake,
}: {
  parsed: Parsed
  rows: ReadonlyArray<Row>
  at: number
  goal: ThreadGoal | null
  onTake: (row: Row) => void
}) {
  if (parsed.kind === 'unknown') return <span className={s.strip}>Goals are set in a task’s conversation</span>
  if (parsed.kind === 'finding') {
    const chosen = rows[at]
    return (
      <span className={s.strip}>
        {chosen !== undefined && 'command' in chosen && <span className={s.stripDoes}>{chosen.command.does}</span>}
        {rows.length > 1 &&
          rows.map((row, index) =>
            'command' in row ? (
              <span
                key={row.key}
                className={s.stripName}
                aria-current={index === at || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onTake(row)}
              >
                /{row.command.name}
              </span>
            ) : null,
          )}
      </span>
    )
  }
  if (parsed.kind !== 'command') return null
  if (parsed.command !== GOAL) return <span className={s.strip}>{parsed.command.does}</span>
  if (goal === null) return <span className={s.strip}>Up to 12 turns on its own</span>
  return (
    <span className={s.strip}>
      <span className={s.stripStatus}>{statusOf(goal)}</span>
      {parsed.intent.action === 'replace' ? (
        <span className={s.stripDoes}>Replaces “{goal.objective}”</span>
      ) : (
        rows.map((row, index) =>
          'sub' in row ? (
            <span
              key={row.key}
              className={s.stripName}
              aria-current={index === at || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onTake(row)}
            >
              {row.sub.name}
            </span>
          ) : null,
        )
      )}
    </span>
  )
}

/** D: /goal opened in the panel: the goal itself, then what can be done to it. */
function GoalPanel({ goal, intent, list, onDo }: { goal: ThreadGoal | null; intent: string; list: ReactNode; onDo: () => void }) {
  // What Enter does with what is written, as the list's last say: a row of its own, chosen.
  const act = (label: string) => (
    <div className={s.list}>
      <div role="option" aria-selected className={s.row} onMouseDown={(event) => event.preventDefault()} onClick={onDo}>
        <span className={s.tile}>
          <Icon name="up" size={13} />
        </span>
        <span className={s.act}>{label}</span>
      </div>
    </div>
  )
  if (goal === null)
    return (
      <div className={s.goal}>
        <div className={s.goalTop}>
          <span className={s.goalLabel}>
            <Icon name={GOAL.icon} size={13} />
            Goal
          </span>
          <span className={s.now}>Not set</span>
        </div>
        <p className={s.goalFacts}>The lead keeps working toward it on its own, up to 12 turns, until it’s done or stuck.</p>
        {intent === 'set' && act('Set the goal')}
      </div>
    )
  return (
    <div className={s.goal}>
      <div className={s.goalTop}>
        <span className={s.goalLabel}>
          <Icon name={GOAL.icon} size={13} />
          Goal
        </span>
        <span className={s.now}>
          {statusOf(goal)} · {goal.rounds} of {goal.roundLimit} turns
        </span>
      </div>
      <p className={s.goalObjective}>{goal.objective}</p>
      {(goal.detail ?? goal.progress) !== null && <p className={s.goalFacts}>{goal.detail ?? goal.progress}</p>}
      {intent === 'replace' ? act('Replace the goal') : list}
    </div>
  )
}

/* -------------------------------------------------------------------------------------------------------------------- */

/** B: a row of the composer's own, over its field. */
function Inside({ field, children }: { field: RefObject<HTMLTextAreaElement | null>; children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const box = field.current?.parentElement
    const form = box?.parentElement
    if (box == null || form == null) return
    const el = document.createElement('div')
    el.className = s.inside ?? ''
    form.insertBefore(el, box)
    setSlot(el)
    return () => {
      el.remove()
      setSlot(null)
    }
  }, [field])
  return slot === null ? null : createPortal(children, slot)
}

/**
 * The field's words drawn again over it, letter for letter, as the kit draws
 * words still arriving while dictating: so the command reads as one (A's
 * token, C's and D's cobalt), and what is still to come is written ahead in
 * grey where the caret is.
 */
function Mirror({
  field,
  value,
  parsed,
  d,
  goal,
  at,
  rows,
}: {
  field: RefObject<HTMLTextAreaElement | null>
  value: string
  parsed: Parsed
  d: Shown
  goal: ThreadGoal | null
  at: number
  rows: ReadonlyArray<Row>
}) {
  const [box, setBox] = useState<HTMLElement | null>(null)
  const mirror = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = field.current
    if (el === null) return
    setBox(el.parentElement)
    el.style.color = 'transparent'
    el.style.caretColor = 'var(--t-1)'
    const follow = () => {
      if (mirror.current !== null) mirror.current.scrollTop = el.scrollTop
    }
    el.addEventListener('scroll', follow)
    return () => {
      el.style.color = ''
      el.style.caretColor = ''
      el.removeEventListener('scroll', follow)
    }
  }, [field])
  useLayoutEffect(() => {
    const el = field.current
    const own = mirror.current
    if (el === null || own === null) return
    const style = getComputedStyle(el)
    own.style.font = style.font
    own.style.letterSpacing = style.letterSpacing
    own.style.padding = style.padding
  }, [field, box])
  if (box === null) return null

  // How the command reads: the name, with the word after it where that is one of what it takes.
  const typed = /^(\/\S*)(\s?)(\S*)([\s\S]*)$/.exec(value)
  const name = typed?.[1] ?? value
  const space = typed?.[2] ?? ''
  const word = typed?.[3] ?? ''
  const after = typed?.[4] ?? ''
  const subbed = parsed.kind === 'command' && parsed.command === GOAL && ['pause', 'resume', 'clear', 'edit'].includes(word.toLowerCase())
  const known = parsed.kind === 'command'
  const command = known ? name + (subbed ? space + word : '') : name
  const rest = known ? (subbed ? after : space + word + after) : space + word + after

  // What is written ahead: the rest of the best match (C), or what the command takes.
  let ghost = ''
  const chosen = rows[at]
  if (parsed.kind === 'finding' && d === 'c' && chosen !== undefined && 'command' in chosen)
    ghost = chosen.command.name.startsWith(parsed.query) ? chosen.command.name.slice(parsed.query.length) : ''
  if (parsed.kind === 'command' && rest.trim() === '' && !subbed) {
    if (d === 'c' && chosen !== undefined && 'sub' in chosen) ghost = chosen.sub.name
    else ghost = parsed.command.takes?.(goal) ?? ''
  }
  if (parsed.kind === 'command' && d === 'c' && chosen !== undefined && 'sub' in chosen && word !== '' && !subbed && after === '')
    ghost = chosen.sub.name.startsWith(word.toLowerCase()) ? chosen.sub.name.slice(word.length) : ''

  return createPortal(
    <div ref={mirror} className={s.mirror} aria-hidden="true">
      <span className={known ? (d === 'a' ? s.token : s.typed) : s.typing}>{command}</span>
      {rest}
      {ghost !== '' && <span className={s.ghost}>{ghost}</span>}
    </div>,
    box,
  )
}
