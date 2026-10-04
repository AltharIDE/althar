import { Dialog } from 'radix-ui'
import { type KeyboardEvent, useEffect, useRef } from 'react'

import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Delta } from '../../primitives/FileChanges/FileChanges'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { Diff, type DiffLine } from '../../thread/Diff/Diff'
import s from './ChangeView.module.css'

/*
 * What a task changed, file by file, over the whole window: the files on the
 * left, with how each changed and how much, and the one you're on as a diff
 * beside them. What isn't committed yet says so, since only commits are
 * pushed. Escape closes it; j and k, or the arrows, go through the files.
 */

/** How a file changed. */
export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface ViewedFile {
  path: string
  /** Where it was, for a file that moved. */
  from?: string | null
  status: ChangedFileStatus
  add: number
  del: number
  binary?: boolean
  /** Some of its change isn't committed yet. */
  uncommitted?: boolean
}

/** The file you're on: its diff while it's read, once it's read, or why it couldn't be. */
export type FileView =
  | { state: 'loading' }
  | { state: 'failed'; message?: string }
  | { state: 'ready'; lines: readonly DiffLine[]; truncated?: boolean }

export interface ChangeViewText {
  title: string
  close: string
  closeKey: string
  files: (count: number) => string
  /** Where the change goes: `branch into main`. */
  into: (branch: string, base: string) => string
  status: Record<Exclude<ChangedFileStatus, 'modified'>, string>
  movedFrom: (from: string) => string
  uncommitted: string
  uncommittedNote: string
  binary: string
  moved: (from: string) => string
  empty: string
  loading: string
  failed: string
  tryAgain: string
  truncated: string
  list: string
}

export const changeViewText: ChangeViewText = {
  title: 'Changes',
  close: 'Close',
  closeKey: 'esc',
  files: (count) => (count === 1 ? '1 file' : `${count} files`),
  into: (branch, base) => `${branch} into ${base}`,
  status: { added: 'New', deleted: 'Deleted', renamed: 'Moved' },
  movedFrom: (from) => `from ${from}`,
  uncommitted: 'Not committed',
  uncommittedNote: 'Not committed yet. Althar pushes commits only, so this part isn’t in what it pushes.',
  binary: 'A binary file. Its contents aren’t shown.',
  moved: (from) => `Moved from ${from}, with nothing else changed.`,
  empty: 'Nothing has changed yet.',
  loading: 'Reading the diff',
  failed: 'Althar couldn’t read this file’s diff.',
  tryAgain: 'Try again',
  truncated: 'Cut short here. The rest is in the file.',
  list: 'Changed files',
}

export interface ChangeViewProps {
  /** The task's branch, and the branch it goes into. */
  branch: string
  base?: string
  files: readonly ViewedFile[]
  /** The file you're on; with none, the first. */
  selected: string | null
  onSelect: (path: string) => void
  /** The selected file's diff. */
  view: FileView
  onRetry?: () => void
  onClose: () => void
  text?: Partial<ChangeViewText>
}

/** Lines added and removed, each only when there are some: a moved or binary file shows none. */
const counts = (add: number, del: number) => ({ ...(add > 0 ? { add } : {}), ...(del > 0 ? { del } : {}) })

const split = (path: string) => {
  const cut = path.lastIndexOf('/') + 1
  return { dir: path.slice(0, cut), name: path.slice(cut) }
}

/** A task's change over the whole window. A modal dialog: mount it to open it. */
export function ChangeView({ branch, base, files, selected, onSelect, view, onRetry, onClose, text }: ChangeViewProps) {
  const t = { ...changeViewText, ...text }
  const current = files.find((file) => file.path === selected) ?? files[0]
  const add = files.reduce((sum, file) => sum + file.add, 0)
  const del = files.reduce((sum, file) => sum + file.del, 0)
  const code = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  // A new file starts at its top.
  useEffect(() => {
    if (code.current !== null) code.current.scrollTop = 0
  }, [current?.path])

  const step = (by: number) => {
    if (current === undefined) return
    const next = files[files.indexOf(current) + by]
    if (next !== undefined) onSelect(next.path)
  }
  const keys = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement
    if (event.metaKey || event.ctrlKey || event.altKey || target.isContentEditable || target.tagName === 'INPUT') return
    if (event.key === 'j' || event.key === 'ArrowDown') step(1)
    else if (event.key === 'k' || event.key === 'ArrowUp') step(-1)
    else return
    event.preventDefault()
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content
          ref={dialog}
          className={cx('ch-root', s.dialog)}
          aria-describedby={undefined}
          onKeyDown={keys}
          // The view itself takes focus, where j and k work, rather than its close button.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            dialog.current?.focus()
          }}
        >
          <header className={s.head}>
            <Dialog.Title className={s.title}>{t.title}</Dialog.Title>
            <span className={s.branch}>{base ? t.into(branch, base) : branch}</span>
            <span className={s.sum}>
              {t.files(files.length)}
              <Delta {...counts(add, del)} />
            </span>
            <Dialog.Close asChild>
              <ActionButton icon="close" kbd={t.closeKey} className={s.close}>
                {t.close}
              </ActionButton>
            </Dialog.Close>
          </header>
          {current === undefined ? (
            <p className={s.empty}>{t.empty}</p>
          ) : (
            <div className={s.body}>
              <nav className={s.files} aria-label={t.list}>
                <ul>
                  {files.map((file) => {
                    const { dir, name } = split(file.path)
                    const on = file.path === current.path
                    const status = file.status === 'modified' ? null : t.status[file.status]
                    return (
                      <li key={file.path}>
                        <button
                          type="button"
                          className={cx(s.file, on && s.on)}
                          aria-current={on ? 'true' : undefined}
                          onClick={() => onSelect(file.path)}
                        >
                          <span className={s.path}>
                            <span className={s.dir}>{dir}</span>
                            {name}
                          </span>
                          <Delta {...counts(file.add, file.del)} className={s.delta} />
                          {(status !== null || file.uncommitted) && (
                            <span className={s.meta}>
                              {[status, file.uncommitted ? t.uncommitted : null].filter((part) => part !== null).join(' · ')}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </nav>
              <section className={s.code} ref={code} aria-label={current.path}>
                <div className={s.fileHead}>
                  <span className={s.filePath}>{current.path}</span>
                  {current.from && <span className={s.from}>{t.movedFrom(current.from)}</span>}
                </div>
                {current.uncommitted && <p className={s.note}>{t.uncommittedNote}</p>}
                <FileBody file={current} view={view} t={t} {...(onRetry === undefined ? {} : { onRetry })} />
              </section>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function FileBody({ file, view, t, onRetry }: { file: ViewedFile; view: FileView; t: ChangeViewText; onRetry?: () => void }) {
  if (file.binary) return <p className={s.quiet}>{t.binary}</p>
  switch (view.state) {
    case 'loading':
      return (
        <p className={s.quiet}>
          <Spinner size="small" />
          {t.loading}
        </p>
      )
    case 'failed':
      return (
        <div className={s.failed} role="alert">
          <p>{view.message ?? t.failed}</p>
          {onRetry && (
            <Button variant="quiet" onClick={onRetry}>
              {t.tryAgain}
            </Button>
          )}
        </div>
      )
    case 'ready':
      if (view.lines.length === 0) return <p className={s.quiet}>{file.from ? t.moved(file.from) : t.empty}</p>
      return (
        <>
          <Diff lines={view.lines} label={file.path} oldNumbers className={s.diff} />
          {view.truncated && <p className={s.quiet}>{t.truncated}</p>}
        </>
      )
  }
}
