import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { CommandDetail, CommandOption, CommandState, ComposerCommand } from './commands'
import s from './CommandPanel.module.css'

/*
 * The composer's commands, on its top edge as dictation's tray is, while a
 * slash starts what is written. Finding one, each command with what it does
 * and where it stands now; one picked opens into what it acts on (the goal
 * itself), then what it takes, or what Enter will do. The field keeps the
 * focus and the keys (a combobox over this list): the rows only answer the
 * pointer. It opens by key many times a day, so it is there at once.
 */

/** A row of the panel: a command to pick, one of what it takes, or what Enter does with what is written. */
export type CommandRow =
  | { readonly kind: 'command'; readonly command: ComposerCommand }
  | { readonly kind: 'option'; readonly option: CommandOption }
  | { readonly kind: 'action'; readonly label: string }

/** The rows for what is written: the commands it could be, or of the one picked what it takes, or else what Enter does. */
export const commandRows = (state: CommandState): readonly CommandRow[] => {
  if (state.kind === 'finding') return state.matches.map((command) => ({ kind: 'command', command }))
  if (state.kind !== 'picked' || state.command.unavailable !== undefined) return []
  if (state.options.length > 0) return state.options.map((option) => ({ kind: 'option', option }))
  return state.action === null ? [] : [{ kind: 'action', label: state.action }]
}

export interface CommandPanelProps {
  state: Extract<CommandState, { kind: 'finding' | 'picked' }>
  rows: readonly CommandRow[]
  /** The row the keys are on. */
  active: number
  /** The list's id, which the field points at; each row's is it and its place. */
  id: string
  label: string
  onPick: (row: CommandRow) => void
  onActive: (index: number) => void
}

export function CommandPanel({ state, rows, active, id, label, onPick, onActive }: CommandPanelProps) {
  const picked = state.kind === 'picked' ? state.command : null
  return (
    <div className={s.panel} data-commands="">
      {picked !== null && (picked.detail !== undefined ? <Detail detail={picked.detail} icon={picked} /> : <Head command={picked} />)}
      {rows.length > 0 && (
        <div id={id} role="listbox" aria-label={label} className={cx(s.list, picked !== null && s.under)}>
          {rows.map((row, index) => (
            // A press picks it; the field keeps the focus and the keys.
            <div
              key={keyOf(row, index)}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === active}
              aria-disabled={(row.kind === 'command' && row.command.unavailable !== undefined) || undefined}
              className={s.row}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() => {
                if (index !== active) onActive(index)
              }}
              onClick={() => onPick(row)}
            >
              <Row row={row} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const keyOf = (row: CommandRow, index: number) =>
  row.kind === 'command' ? `/${row.command.name}:${index}` : row.kind === 'option' ? `option:${row.option.name}` : 'action'

function Row({ row }: { row: CommandRow }) {
  if (row.kind === 'action')
    return (
      <>
        <span className={s.tile}>
          <Icon name="up" size={13} />
        </span>
        <span className={s.act}>{row.label}</span>
      </>
    )
  if (row.kind === 'option') {
    const { option } = row
    return (
      <>
        {/* without a mark of its own, its place is kept, so its name lines up with the others' */}
        {option.icon === undefined ? <span /> : <span className={s.tile}>{<Icon name={option.icon} size={13} />}</span>}
        <span className={option.label === undefined ? s.name : s.label}>{option.label ?? option.name}</span>
        <span className={s.does}>{option.does}</span>
        {option.now !== undefined && <span className={s.now}>{option.now}</span>}
      </>
    )
  }
  const { command } = row
  return (
    <>
      <span className={s.tile}>
        <Icon name={command.icon} size={13} />
      </span>
      <span className={s.name}>/{command.name}</span>
      <span className={s.does}>{command.does}</span>
      {(command.unavailable ?? command.now) !== undefined && <span className={s.now}>{command.unavailable ?? command.now}</span>}
    </>
  )
}

/** A command picked that has nothing to show of what it acts on: itself, and why it can't be done here where it can't. */
function Head({ command }: { command: ComposerCommand }) {
  return (
    <div className={s.head}>
      <span className={s.title}>
        <Icon name={command.icon} size={13} />/{command.name}
      </span>
      <span className={s.does}>{command.does}</span>
      {(command.unavailable ?? command.now) !== undefined && <span className={s.now}>{command.unavailable ?? command.now}</span>}
    </div>
  )
}

/** What a command acts on, as it stands: the goal, its objective, its turns and last progress. */
function Detail({ detail, icon }: { detail: CommandDetail; icon: ComposerCommand }) {
  return (
    <div className={s.detail}>
      <div className={s.top}>
        <span className={s.title}>
          <Icon name={icon.icon} size={13} />
          {detail.title}
        </span>
        {(icon.unavailable ?? detail.now) !== undefined && <span className={s.now}>{icon.unavailable ?? detail.now}</span>}
      </div>
      {detail.body !== undefined && <p className={s.body}>{detail.body}</p>}
      {detail.note !== undefined && <p className={s.note}>{detail.note}</p>}
    </div>
  )
}
