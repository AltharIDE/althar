import type { KeyboardEvent, ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Button } from '../../primitives/Button/Button'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Segmented, type SegmentedOption } from '../../primitives/Segmented/Segmented'
import { SidePanel } from '../../primitives/SidePanel/SidePanel'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { Diff, type DiffLine } from '../Diff/Diff'
import {
  type CodeMode,
  type CodeRead,
  type CodeWhere,
  copyOf,
  folderOf,
  type FoundCode,
  type FoundFile,
  linesOf,
  markOf,
  nameOf,
  sizeOf,
  withoutLines,
} from './code'
import { CodeLines, codeLinesText, type CodeLinesText } from './CodeLines'
import s from './Code.module.css'

/*
 * A file an agent named, read-only, in the two places it shows: a peek over
 * the name, and the panel beside the conversation. Each says what it is,
 * where it was read from, a word where what shows isn't simply the file as
 * it is (the lines were rewritten since, or moved; the file is cut), its
 * lines, and the ways out of Althar to it: the editor, its path.
 */

export interface CodeViewText {
  lines?: Partial<CodeLinesText>
  /** The task's folder, as the peek says where it read it. */
  task: string
  now: string
  said: (ago: string) => string
  inTask: string
  changedHere: string
  byName: string
  show: string
  whenSaid: string
  whenSaidTip: string
  nowLabel: string
  nowTip: string
  file: string
  change: string
  changeTip: string
  rewritten: string
  seeNow: string
  gone: string
  asThey: string
  moved: (then: number, now: number) => string
  past: (line: number, name: string, lines: number) => string
  cut: (name: string, size: string, from: number, to: number, total: number) => string
  missingTitle: string
  missing: (where: string) => string
  missingWhere: { task: string; default: (branch: string) => string }
  near: string
  severalTitle: (n: number, name: string) => string
  several: string
  binaryTitle: string
  binary: (size: string) => string
  largeTitle: string
  large: (size: string) => string
  unreadable: string
  unchanged: string
  copy: string
  beside: string
  inEditor: (editor: string) => string
  orClick: string
  before: string
  next: string
  at: (at: number, of: number) => string
  back: string
}

export const codeViewText: CodeViewText = {
  task: 'this task',
  now: 'now',
  said: (ago) => `as it was when said, ${ago}`,
  inTask: 'in the task’s folder',
  changedHere: 'changed here',
  byName: 'found by its name',
  show: 'Show',
  whenSaid: 'When said',
  whenSaidTip: 'As it was when it was said',
  nowLabel: 'Now',
  nowTip: 'As it is now',
  file: 'File',
  change: 'Change',
  changeTip: 'What the task changed in it',
  rewritten: 'Those lines were rewritten since. These are as they were.',
  seeNow: 'See it now',
  gone: 'The lines it named aren’t there any more: they were rewritten since.',
  asThey: 'As they were',
  moved: (then, now) => `Line ${then} then is line ${now} now: the file changed above it since.`,
  past: (line, name, lines) => `Line ${line} is past the end: ${name} has ${lines} lines. The agent may have counted in another version.`,
  cut: (name, size, from, to, total) =>
    `${name} is ${size}, so only lines ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} are here, around the one named. The rest is in your editor.`,
  missingTitle: 'There’s no such file',
  missing: (where) => `Nothing is at this path ${where}. The agent may have got its name wrong, or it was never written.`,
  missingWhere: { task: 'in the task’s folder', default: (branch) => `on ${branch}` },
  near: 'Files of nearly that name:',
  severalTitle: (n, name) => `${n} files are called ${name}`,
  several: 'The message doesn’t say which. Each opens here:',
  binaryTitle: 'Not text',
  binary: (size) => `It is ${size} of something other than text, so Althar doesn’t show it. Open it in the app that reads it.`,
  largeTitle: 'Too large to show',
  large: (size) => `It is ${size}. Open it in your editor.`,
  unreadable: 'Althar couldn’t read this file.',
  unchanged: 'The task didn’t change this file.',
  copy: 'Copy path',
  beside: 'Open beside',
  inEditor: (editor) => `Open in ${editor}`,
  orClick: 'Or ⌘-click its name',
  before: 'The reference before',
  next: 'The next reference',
  at: (at, of) => `${at} of ${of}`,
  back: 'Back to the document',
}

/* ——— Its title ——— */

/** Where a file is, after its name: quiet, cut from its start. */
function Folder({ path }: { path: string }) {
  const folder = folderOf(path).replace(/\/$/, '')
  if (folder === '') return null
  return (
    <span className={s.titleFolder} title={path}>
      <bdi>{folder}</bdi>
    </span>
  )
}

/** What a name names, as a title: the file's name and its lines, or the name in code; with its folder after, where asked. */
export function CodeTitle({ found, folder = false }: { found: FoundCode; folder?: boolean }) {
  const name = found.kind === 'several' ? withoutLines(found.name) : nameOf(found.path)
  const lines = found.kind === 'missing' ? '' : found.kind === 'file' && found.symbol !== undefined ? '' : linesOf(found.line, found.end)
  return (
    <span className={s.title}>
      <Icon name="file" size={13} />
      <span className={s.titleName}>
        {found.kind === 'file' && found.symbol !== undefined ? found.symbol : name}
        {lines !== '' && <span className={s.titleLines}>{lines}</span>}
      </span>
      {folder &&
        found.kind !== 'several' &&
        (found.kind === 'file' && found.symbol !== undefined ? (
          <span className={s.titleFolder}>{nameOf(found.path)}</span>
        ) : (
          <Folder path={found.path} />
        ))}
    </span>
  )
}

/* ——— Where it was read from, and how else to see it ——— */

/** The ways to see a file: when said and now, where it changed since; the file and what the task changed in it. */
export const modesOf = (found: FoundCode, t: CodeViewText = codeViewText): ReadonlyArray<SegmentedOption<CodeMode>> => {
  if (found.kind !== 'file' || found.content !== 'text') return []
  const modes: SegmentedOption<CodeMode>[] = []
  if (found.since !== null) {
    modes.push({ value: 'then', label: t.whenSaid, tooltip: { label: t.whenSaidTip } })
    modes.push({ value: 'now', label: t.nowLabel, tooltip: { label: t.nowTip } })
  }
  if (found.changed !== null) {
    if (modes.length === 0) modes.push({ value: 'now', label: t.file })
    modes.push({ value: 'change', label: `${t.change} +${found.changed.add} −${found.changed.del}`, tooltip: { label: t.changeTip } })
  }
  return modes.length > 1 ? modes : []
}

function Branch({ where }: { where: CodeWhere }) {
  return (
    <>
      <Icon name="branch" size={12} />
      <span className={s.branch} title={where.branch}>
        {where.branch}
      </span>
    </>
  )
}

/** Under the panel's head: its path to copy, where it was read from, and the ways to see it. */
function Meta({
  found,
  where,
  mode,
  onMode,
  t,
}: {
  found: FoundCode
  where: CodeWhere | undefined
  mode: CodeMode
  onMode: (mode: CodeMode) => void
  t: CodeViewText
}) {
  const modes = modesOf(found, t)
  const path = found.kind === 'several' ? null : found.path
  const when =
    where === undefined || modes.length > 0
      ? null
      : where.kind === 'task'
        ? t.inTask
        : mode === 'then' && where.said !== undefined
          ? t.said(where.said)
          : t.now
  return (
    <div className={s.meta}>
      {path !== null && (
        <span className={s.pathRow}>
          <span className={s.path} title={path}>
            <bdi>
              {folderOf(path)}
              <strong>{nameOf(path)}</strong>
            </bdi>
          </span>
          {/* Beside the path it copies, not in the head, where the file's name needs the room. */}
          <CopyButton ghost value={copyOf(found)} text={{ copy: t.copy }} className={s.copy} />
        </span>
      )}
      {where !== undefined && (
        <span className={s.where}>
          <Branch where={where} />
          {when !== null && <span>{when}</span>}
        </span>
      )}
      {found.kind === 'file' && found.byName && <span className={s.byName}>{t.byName}</span>}
      {modes.length > 0 && <Segmented<CodeMode> label={t.show} value={mode} onChange={onMode} options={modes} className={s.modes} />}
    </div>
  )
}

/** A word over the lines, where what shows isn't simply the file as it is. */
function Notes({
  found,
  mode,
  read,
  onMode,
  t,
}: {
  found: FoundFile
  mode: CodeMode
  read: CodeRead | null | undefined
  /** The way to the other version, where the note offers one; the peek shows only its own. */
  onMode?: (mode: CodeMode) => void
  t: CodeViewText
}) {
  const notes: ReactNode[] = []
  const rewritten = found.since?.now === null
  if (rewritten && mode === 'then')
    notes.push(
      <div key="rewritten" className={s.note}>
        <span>{t.rewritten}</span>
        {onMode !== undefined && (
          <button type="button" onClick={() => onMode('now')}>
            {t.seeNow}
          </button>
        )}
      </div>,
    )
  else if (rewritten && mode === 'now' && found.line !== undefined)
    notes.push(
      <div key="gone" className={s.note}>
        <span>{t.gone}</span>
        {onMode !== undefined && (
          <button type="button" onClick={() => onMode('then')}>
            {t.asThey}
          </button>
        )}
      </div>,
    )
  else if (mode === 'now' && found.line !== undefined && found.since?.now != null && found.since.now.line !== found.line)
    notes.push(
      <div key="moved" className={s.note}>
        <span>{t.moved(found.line, found.since.now.line)}</span>
      </div>,
    )
  if (found.since === null && found.line !== undefined && found.line > found.lines && found.content === 'text')
    notes.push(
      <div key="past" className={s.note}>
        <span>{t.past(found.line, nameOf(found.path), found.lines)}</span>
      </div>,
    )
  if (mode !== 'change' && read?.cut === true)
    notes.push(
      <div key="cut" className={s.note}>
        <span>{t.cut(nameOf(found.path), sizeOf(found.bytes), read.from, read.from + read.text.split('\n').length - 1, read.total)}</span>
      </div>,
    )
  return <>{notes}</>
}

/* ——— What shows in place of the lines ——— */

function Choices({ paths, suffix = '', onGo }: { paths: readonly string[]; suffix?: string; onGo: (path: string) => void }) {
  return (
    <ul className={s.choices}>
      {paths.map((path) => (
        <li key={path}>
          <button type="button" className={s.choice} onClick={() => onGo(`${path}${suffix.replace('–', '-')}`)}>
            <Icon name="file" size={12} />
            <span className={s.choiceFolder}>{folderOf(path)}</span>
            {nameOf(path)}
            {suffix}
          </button>
        </li>
      ))}
    </ul>
  )
}

function Reading() {
  return (
    <div className={s.reading} aria-busy="true">
      {['62%', '48%', '71%', '30%', '55%'].map((width, i) => (
        <Skeleton key={i} width={width} />
      ))}
    </div>
  )
}

function Body({
  found,
  where,
  mode,
  read,
  change,
  around,
  onGo,
  t,
}: {
  found: FoundCode
  where: CodeWhere | undefined
  mode: CodeMode
  read: CodeRead | null | undefined
  change?: readonly DiffLine[] | null | undefined
  around?: number
  onGo: (path: string) => void
  t: CodeViewText
}) {
  if (found.kind === 'missing')
    return (
      <div className={s.say}>
        <h3>{t.missingTitle}</h3>
        <p>
          <code>{found.path}</code>
        </p>
        <p>{t.missing(where === undefined || where.kind === 'task' ? t.missingWhere.task : t.missingWhere.default(where.branch))}</p>
        {found.near.length > 0 && (
          <>
            <p>{t.near}</p>
            <Choices paths={found.near} onGo={onGo} />
          </>
        )}
      </div>
    )
  if (found.kind === 'several')
    return (
      <div className={s.say}>
        <h3>{t.severalTitle(found.paths.length, nameOf(withoutLines(found.name)))}</h3>
        <p>{t.several}</p>
        <Choices paths={found.paths} suffix={linesOf(found.line, found.end)} onGo={onGo} />
      </div>
    )
  if (found.content !== 'text')
    return (
      <div className={s.say}>
        <h3>{found.content === 'binary' ? t.binaryTitle : t.largeTitle}</h3>
        <p>{found.content === 'binary' ? t.binary(sizeOf(found.bytes)) : t.large(sizeOf(found.bytes))}</p>
      </div>
    )
  if (mode === 'change') {
    if (change === undefined) return <Reading />
    if (change === null || change.length === 0) return <div className={s.say}>{t.unchanged}</div>
    return (
      <div className={s.diff}>
        <Diff lines={change} label={found.path} path={found.path} fold={4} oldNumbers />
      </div>
    )
  }
  if (read === undefined) return <Reading />
  if (read === null) return <div className={s.say}>{t.unreadable}</div>
  return (
    <CodeLines
      key={`${found.path}\u0000${mode}`}
      path={found.path}
      read={read}
      mark={markOf(found, mode)}
      text={{ ...codeLinesText, ...t.lines }}
      {...(around === undefined ? {} : { around })}
    />
  )
}

/* ——— The peek ——— */

export interface CodePeekProps {
  found: FoundCode
  /** Where it was read from; unknown until the host knows. */
  where?: CodeWhere
  /** Its lines as it first shows (firstMode): undefined while read, null where they couldn't be. */
  read?: CodeRead | null
  /** The whole file, in the panel beside the conversation; without it, no way there from the peek, as for the coordinator's. */
  onBeside?: () => void
  /** The person's editor, which opens it at its line. */
  editor?: { readonly name: string; readonly onOpen: () => void }
  /** Opens another file in the panel: one of several of a name, one of nearly the name of one that isn't there. */
  onGo: (path: string) => void
  text?: Partial<CodeViewText>
}

/** What shows over a name in what an agent wrote, while it is pointed at: the lines it named and a few around them, and the ways on. */
export function CodePeek({ found, where, read, onBeside, editor, onGo, text }: CodePeekProps) {
  const t = { ...codeViewText, ...text }
  const mode = found.kind === 'file' && found.since?.now === null ? 'then' : 'now'
  // A range taller than the peek shows from its start, with fewer lines around it.
  const long = found.kind === 'file' && found.line !== undefined && found.end !== undefined && found.end - found.line > 14
  const file = found.kind === 'file' ? found : null
  return (
    <>
      <div className={s.peekHead}>
        <CodeTitle found={found} folder />
        {found.kind !== 'several' && <CopyButton ghost value={copyOf(found)} text={{ copy: t.copy }} className={s.copy} />}
      </div>
      {file !== null && <Notes found={file} mode={mode} read={read} t={t} />}
      <div className={s.peekBody}>
        <Body found={found} where={where} mode={mode} read={read} around={long ? 2 : 5} onGo={onGo} t={t} />
      </div>
      <div className={s.peekFoot}>
        <span className={s.from}>
          {where !== undefined && (
            <span className={s.fromBranch} title={where.branch}>
              <Icon name="branch" size={12} />
              {where.kind === 'task' ? t.task : where.branch}
            </span>
          )}
          {where !== undefined && <span>{mode === 'then' && where.said !== undefined ? t.said(where.said) : t.now}</span>}
          {file?.changed != null && (
            <span>
              {t.changedHere} <span className={s.add}>+{file.changed.add}</span> <span className={s.del}>−{file.changed.del}</span>
            </span>
          )}
        </span>
        <span className={s.peekActions}>
          {/* Beside, where it shows more than this does: not for a file that isn't there and has none like it. */}
          {onBeside !== undefined && (found.kind !== 'missing' || found.near.length > 0) && (
            <Button size="small" variant="quiet" onClick={onBeside}>
              {t.beside}
            </Button>
          )}
          {file !== null && editor !== undefined && (
            <Tooltip label={t.orClick} placement="below" align="end">
              <Button size="small" onClick={editor.onOpen}>
                {t.inEditor(editor.name)}
              </Button>
            </Tooltip>
          )}
        </span>
      </div>
    </>
  )
}

/* ——— The panel ——— */

export interface CodePanelProps {
  found: FoundCode
  where?: CodeWhere
  mode: CodeMode
  onMode: (mode: CodeMode) => void
  /** Its lines in the mode shown: undefined while read, null where they couldn't be. */
  read?: CodeRead | null
  /** What the task changed in it, for Change: undefined while read, null where it couldn't be. */
  change?: readonly DiffLine[] | null
  /** Open it in the editor, and in another: the host's. */
  actions?: ReactNode
  /** Its place among the conversation's references, to step to the one before or after. */
  nav?: { readonly at: number; readonly of: number; readonly onStep: (by: -1 | 1) => void }
  /** Opens another file here: one of several of a name, one of nearly the name of one that isn't there. */
  onGo: (path: string) => void
  /** Back to what it was opened from, under it: the lead's document. */
  onBack?: () => void
  onClose: () => void
  /** ⌘↩ and other keys of the host's, while focus is in the panel. */
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void
  /** Narrow: the reference's count leaves the head to the file's name. */
  compact?: boolean
  text?: Partial<CodeViewText>
  className?: string
}

/** A file an agent named, whole, beside the conversation: scrolled to the lines it named, with the ways to see it and to open it elsewhere. */
export function CodePanel({
  found,
  where,
  mode,
  onMode,
  read,
  change,
  actions,
  nav,
  onGo,
  onBack,
  onClose,
  onKeyDown,
  compact = false,
  text,
  className,
}: CodePanelProps) {
  const t = { ...codeViewText, ...text }
  const name = found.kind === 'several' ? found.name : nameOf(found.path)
  return (
    <SidePanel
      label={name}
      head={<CodeTitle found={found} />}
      actions={
        <>
          {nav !== undefined && nav.of > 1 && (
            <span className={s.nav}>
              <IconButton icon="chevronU" label={t.before} kbd="⌥↑" size="small" tooltip="below" onClick={() => nav.onStep(-1)} />
              {!compact && <span>{t.at(nav.at, nav.of)}</span>}
              <IconButton icon="chevronD" label={t.next} kbd="⌥↓" size="small" tooltip="below" onClick={() => nav.onStep(1)} />
            </span>
          )}
          {actions}
        </>
      }
      onClose={onClose}
      {...(onBack === undefined ? {} : { onBack, text: { back: t.back } })}
      {...(onKeyDown === undefined ? {} : { onKeyDown })}
      {...(className === undefined ? {} : { className })}
    >
      <Meta found={found} where={where} mode={mode} onMode={onMode} t={t} />
      {found.kind === 'file' && <Notes found={found} mode={mode} read={read} onMode={onMode} t={t} />}
      <div className={s.panelBody}>
        <Body found={found} where={where} mode={mode} read={read} change={change} onGo={onGo} t={t} />
      </div>
    </SidePanel>
  )
}
