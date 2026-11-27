import { type FormEvent, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Button } from '../../primitives/Button/Button'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { Field } from '../../primitives/Field/Field'
import { Path } from '../../primitives/Path/Path'
import s from './WorktreeBody.module.css'

/*
 * A task's worktree, open in its parts (the redesign's direction C): its
 * branch and the branch it goes into on one line, its folder under it; what
 * it changed as one bar, its lines added and removed, opening into the
 * files; then its actions. A long branch or folder keeps both its ends and
 * shortens in the middle, whole on hover and copied whole. Pressing the
 * branch it goes into asks for another, with the one line that holds for it.
 */

export interface WorktreeFile {
  path: string
  add: number
  del: number
  binary?: boolean
}

export interface WorktreeBodyText {
  /** The button on the branch it goes into. */
  changeTarget: (branch: string) => string
  /** The same button where the branch it goes into isn't known. */
  towardOther: string
  towardField: string
  towardIt: string
  files: (n: number) => string
  /** The bar, said: Show the 21 files, Hide them. */
  showFiles: (n: number) => string
  hideFiles: string
  copyBranch: string
  copyFolder: string
}

export const worktreeBodyText: WorktreeBodyText = {
  changeTarget: (branch) => `Goes into ${branch}. Work toward another branch`,
  towardOther: 'Work toward…',
  towardField: 'Another branch to work toward',
  towardIt: 'Work toward it',
  files: (n) => `${n} ${n === 1 ? 'file' : 'files'} changed`,
  showFiles: (n) => `Show the ${n} ${n === 1 ? 'file' : 'files'}`,
  hideFiles: 'Hide the files',
  copyBranch: 'Copy the branch',
  copyFolder: 'Copy the folder',
}

/** Text that shortens in its middle, keeping its start and its last `keep` characters. */
function Middle({ text, keep, className }: { text: string; keep: number; className?: string | undefined }) {
  const cut = Math.max(0, text.length - keep)
  return (
    <span className={[s.middle, className].filter(Boolean).join(' ')} title={text}>
      <span className={s.start}>{text.slice(0, cut)}</span>
      <span className={s.tail}>{text.slice(cut)}</span>
    </span>
  )
}

/** A folder keeps its last name whole: …/althar. */
const folderTail = (path: string) => {
  const at = path.replace(/[/\\]+$/, '').search(/[/\\][^/\\]*$/)
  return at < 0 ? path.length : Math.min(path.length - at, 28)
}

export interface WorktreeBodyProps {
  branch: string | null
  /** The branch it goes into: main, release/0.8.0. */
  target: string | null
  /** Its folder here, or where it is in words (a worker's name), as `place`. */
  folder: string | null
  place?: string
  files: ReadonlyArray<WorktreeFile>
  /** Points it at another branch; without it, the branch it goes into is only said. */
  onToward?: (branch: string) => void
  /** What working toward another does for this task, in one line. */
  towardNote?: string
  text?: Partial<WorktreeBodyText>
}

export function WorktreeBody({ branch, target, folder, place, files, onToward, towardNote, text }: WorktreeBodyProps) {
  const t = { ...worktreeBodyText, ...text }
  const [toward, setToward] = useState(false)
  const [typed, setTyped] = useState('')
  const [listed, setListed] = useState(false)
  const added = files.reduce((sum, one) => (one.binary === true ? sum : sum + one.add), 0)
  const removed = files.reduce((sum, one) => (one.binary === true ? sum : sum + one.del), 0)
  const lines = added + removed
  const go = (event: FormEvent) => {
    event.preventDefault()
    const name = typed.trim()
    if (name === '' || onToward === undefined) return
    onToward(name)
    setTyped('')
    setToward(false)
  }

  return (
    <div className={s.body}>
      <div className={s.where}>
        {(branch !== null || target !== null || onToward !== undefined) && (
          <div className={s.flow}>
            <Icon name="branch" size={12} className={s.glyph} />
            {branch !== null && <Middle text={branch} keep={14} className={s.branch} />}
            {(target !== null || onToward !== undefined) && <Icon name="arrow" size={11} className={s.arrow} />}
            {onToward === undefined ? (
              target !== null && <code className={s.target}>{target}</code>
            ) : (
              <button
                type="button"
                className={s.target}
                aria-expanded={toward}
                {...(target === null ? {} : { 'aria-label': t.changeTarget(target) })}
                onClick={() => setToward((open) => !open)}
              >
                {target === null ? <span>{t.towardOther}</span> : <code>{target}</code>}
                <Icon name={toward ? 'chevronU' : 'chevronD'} size={10} />
              </button>
            )}
            {branch !== null && <CopyButton value={branch} ghost className={s.copy} text={{ copy: t.copyBranch }} />}
          </div>
        )}
        {(folder !== null || place !== undefined) && (
          <div className={s.flow}>
            <Icon name="folder" size={12} className={s.glyph} />
            {folder === null ? (
              <span className={s.place}>{place}</span>
            ) : (
              <>
                <Middle text={folder} keep={folderTail(folder)} className={s.folder} />
                <CopyButton value={folder} ghost className={s.copy} text={{ copy: t.copyFolder }} />
              </>
            )}
          </div>
        )}
      </div>

      {toward && onToward !== undefined && (
        <form className={s.toward} onSubmit={go}>
          <div className={s.towardRow}>
            <Field
              size="default"
              placeholder={t.towardField}
              aria-label={t.towardField}
              value={typed}
              ref={(node) => node?.focus()}
              spellCheck={false}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.stopPropagation()
                setToward(false)
              }}
            />
            <Button size="small" variant="signal" type="submit" disabled={typed.trim() === ''}>
              {t.towardIt}
            </Button>
          </div>
          {towardNote !== undefined && <p className={s.note}>{towardNote}</p>}
        </form>
      )}

      {files.length > 0 && (
        <div className={s.changes}>
          <button
            type="button"
            className={s.stat}
            aria-expanded={listed}
            aria-label={listed ? t.hideFiles : t.showFiles(files.length)}
            onClick={() => setListed((open) => !open)}
          >
            <span className={s.statCount}>{t.files(files.length)}</span>
            <span className={s.add}>+{added}</span>
            <span className={s.del}>−{removed}</span>
            <span className={s.meter} aria-hidden="true">
              <span className={s.meterAdd} style={{ flexGrow: lines === 0 ? 1 : added }} />
              <span className={s.meterDel} style={{ flexGrow: lines === 0 ? 0 : removed }} />
            </span>
            <Icon name={listed ? 'chevronU' : 'chevronD'} size={11} className={s.statChevron} />
          </button>
          {listed && (
            <ul className={s.files}>
              {files.map((file) => (
                <li key={file.path}>
                  <Path path={file.path} className={s.path} />
                  {file.binary !== true && (
                    <span className={s.delta}>
                      <span className={s.add}>+{file.add}</span>
                      <span className={s.del}>−{file.del}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
