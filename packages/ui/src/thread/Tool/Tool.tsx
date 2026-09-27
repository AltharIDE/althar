import type { ReactNode } from 'react'

import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { ToolKind, ToolState, unreachable } from '../../foundations/vocabulary'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Caret, Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { useControlled } from '../../lib/controlled'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { Rhythm } from '../../lib/rhythm'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { ExitShown } from '../Terminal/Terminal'
import s from './Tool.module.css'

/*
 * One row per tool call, by kind: read, edit, search, run, fetch, and the
 * rest. ACP's statuses map to: pending and in progress (cobalt), completed
 * (ink), failed (the exit code in red, nothing else). A call that never ran
 * because someone said no, or was stopped with the turn, is neither: it is
 * set back and says so, without red. Waiting on you is a Permission, not a
 * tool call.
 *
 * Opened, a command or an edit becomes one sheet: the row is its header and
 * the output its body, so a command and what it printed read as one thing.
 */

function glyphOf(kind: ToolKind): IconName {
  switch (kind) {
    case ToolKind.Read:
      return 'file'
    case ToolKind.List:
      return 'folder'
    case ToolKind.Search:
      return 'search'
    case ToolKind.Edit:
      return 'edit'
    case ToolKind.Create:
      return 'create'
    case ToolKind.Delete:
      return 'remove'
    case ToolKind.Move:
      return 'move'
    case ToolKind.Run:
      return 'terminal'
    case ToolKind.Think:
      return 'think'
    case ToolKind.Fetch:
      return 'globe'
    case ToolKind.Mcp:
      return 'plug'
    case ToolKind.Agent:
      return 'agents'
    case ToolKind.PullRequest:
      return 'pr'
    case ToolKind.Comment:
      return 'answer'
    case ToolKind.Push:
      return 'up'
    case ToolKind.Other:
      return 'tool'
    default:
      return unreachable(kind)
  }
}

export interface ToolText {
  copy: Partial<CopyButtonText>
  /** After a declined call. */
  declined: string
  /** After a cancelled call. */
  cancelled: string
  /** The name of the link on the target. */
  openTarget: (target: string) => string
}

export const toolText: ToolText = {
  copy: { copy: 'Copy command' },
  declined: 'Denied',
  cancelled: 'Stopped',
  openTarget: (target) => `Open ${target}`,
}

export interface ToolProps extends Disclosable {
  kind: ToolKind
  /** What it did: Read, Ran, Edited. */
  verb: string
  /** What it did it to: a path, a command. */
  target: string
  /** A trailing note: a count, lines changed. For a failed call, the first part is the exit code. */
  meta?: ReactNode
  /** For a failed call: the exit code, shown in red. */
  exit?: string
  state?: ToolState
  took?: string
  /** For a command: what Copy puts on the clipboard. */
  copy?: string
  /** Opens as a sheet, like a command does. */
  sheet?: boolean
  /** The output. Without it the row does not open. */
  children?: ReactNode
  /** Opens what it acted on, like the file it edited. With it, the target is a link of its own. */
  onOpenTarget?: () => void
  text?: Partial<ToolText>
}

export function Tool({
  kind,
  verb,
  target,
  meta,
  exit,
  state = ToolState.Done,
  took,
  copy,
  sheet,
  children,
  onOpenTarget,
  text,
  ...disclosure
}: ToolProps) {
  const t = { ...toolText, ...text }
  /* the row's look follows it open, so the state is held here and handed to the Disclosure */
  const [open, setOpen] = useControlled(disclosure.open, disclosure.defaultOpen ?? false, disclosure.onOpenChange)
  const opens = children != null
  const run = kind === ToolKind.Run
  const sheetable = sheet || run
  const glyph = state === ToolState.Running ? <Spinner size="small" /> : <Icon name={glyphOf(kind)} size={12} />
  const linked = onOpenTarget != null
  /* a linked target is its own button, beside the toggle rather than in it; the toggle still says it for its name */
  const head = (
    <>
      <span className={s.glyph}>{glyph}</span>
      <span className={s.verb}>{verb}</span>{' '}
      {linked ? <VisuallyHidden>{target}</VisuallyHidden> : <span className={s.target}>{target}</span>}
    </>
  )
  const note = (
    <span className={s.meta}>
      {state === ToolState.Failed && exit && <span className={s.exit}>{exit}</span>}
      {state === ToolState.Declined && <span className={s.said}>{t.declined}</span>}
      {state === ToolState.Cancelled && <span className={s.said}>{t.cancelled}</span>}
      {meta}
      {took && <span className={s.took}>{took}</span>}
    </span>
  )
  const label = linked ? (
    head
  ) : (
    <>
      {head}
      {note}
    </>
  )
  return (
    <Disclosure
      open={open}
      onOpenChange={setOpen}
      className={cx(s.tool, s[state], open && sheetable && s.sheet, sheetable && s.sheetable, run && s.run)}
      rhythm={open && sheetable ? Rhythm.Sheet : Rhythm.Tool}
      busy={state === ToolState.Running}
    >
      <div className={cx(s.row, linked && s.linked)}>
        {opens ? (
          <DisclosureTrigger>
            {/* its hit area stretches over the whole row, so the caret after Copy still opens it */}
            <button type="button" className={s.toggle}>
              {label}
            </button>
          </DisclosureTrigger>
        ) : (
          <div className={s.toggle}>{label}</div>
        )}
        {linked && (
          <>
            <button type="button" className={s.link} onClick={onOpenTarget} aria-label={t.openTarget(target)}>
              {target}
            </button>
            {note}
          </>
        )}
        {opens && copy && (
          <span className={s.copy} inert={!open}>
            <CopyButton value={copy} text={t.copy} />
          </span>
        )}
        {opens && <Caret className={s.caret} />}
      </div>
      {opens && (
        <Fold bleed={false}>
          <div className={s.out}>
            <ExitShown.Provider value={state === ToolState.Failed && !!exit}>{children}</ExitShown.Provider>
          </div>
        </Fold>
      )}
    </Disclosure>
  )
}

export interface ToolGroupProps extends Disclosable {
  /** What the run of calls was: Read 6 files. */
  summary: string
  took?: string
  children: ReactNode
}

/** A run of quiet calls, folded into one line that says what the run was. */
export function ToolGroup({ summary, took, children, ...disclosure }: ToolGroupProps) {
  return (
    <Disclosure {...disclosure}>
      <DisclosureTrigger>
        <button type="button" className={s.groupRow}>
          <span className={s.groupSummary}>{summary}</span>
          {took && <span className={cx(s.took, s.push)}>{took}</span>}
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold>
        <div className={s.groupBody}>{children}</div>
      </Fold>
    </Disclosure>
  )
}
