import { cssVars } from '../../lib/cssVars'
import { cx } from '../../lib/cx'
import s from './FileChanges.module.css'

/*
 * The files a change touched: each path with its directory quieter, the
 * lines added and removed, and a bar for how big its change is against the
 * largest, split by how much of it is addition. Green only for additions,
 * red only for deletions. With onOpen, each file is a link to its diff.
 */

export interface ChangedFile {
  path: string
  add: number
  del: number
}

export interface FileChangesText {
  open: (path: string) => string
}

export const fileChangesText: FileChangesText = { open: (path) => `Open the diff of ${path}` }

export interface FileChangesProps {
  files: readonly ChangedFile[]
  /** The largest change the bars measure against; by default the largest here. Pass it to keep several lists on one scale. */
  most?: number
  onOpen?: (path: string) => void
  className?: string
  text?: Partial<FileChangesText>
}

export function FileChanges({ files, most, onOpen, className, text }: FileChangesProps) {
  const t = { ...fileChangesText, ...text }
  const scale = Math.max(1, most ?? 0, ...files.map((f) => f.add + f.del))
  return (
    <ul className={cx(s.files, className)}>
      {files.map((f) => {
        const cut = f.path.lastIndexOf('/') + 1
        const inner = (
          <>
            <span className={s.path}>
              <span className={s.dir}>{f.path.slice(0, cut)}</span>
              {f.path.slice(cut)}
            </span>
            <Delta add={f.add} del={f.del} />
            <span className={s.bar} style={cssVars({ '--w': (f.add + f.del) / scale, '--a': f.add / Math.max(1, f.add + f.del) })}>
              <i />
            </span>
          </>
        )
        return (
          <li key={f.path}>
            {onOpen ? (
              <button type="button" className={s.file} onClick={() => onOpen(f.path)} aria-label={t.open(f.path)}>
                {inner}
              </button>
            ) : (
              <div className={s.file}>{inner}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Lines added and removed, each shown when given. Green only for additions, red only for deletions. */
export function Delta({ add, del, className }: { add?: number; del?: number; className?: string }) {
  return (
    <span className={cx(s.delta, className)}>
      {add != null && <span className={s.add}>+{add}</span>}
      {del != null && <span className={s.del}>−{del}</span>}
    </span>
  )
}

/** GitHub's five squares: how much of the change is addition. */
export function DiffStat({ add, del }: { add: number; del: number }) {
  const green = add + del === 0 ? 0 : Math.round((add / (add + del)) * 5)
  return (
    <span className={s.stat} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} className={i < green ? s.statAdd : s.statDel} />
      ))}
    </span>
  )
}
