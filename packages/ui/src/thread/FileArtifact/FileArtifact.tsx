import { useId, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { Markdown } from '../Markdown/Markdown'
import { useThreadShell } from '../Shell/Shell'
import s from './FileArtifact.module.css'

export interface FileArtifactText {
  lines: (n: number) => string
  open: string
  readMore: string
  /** A file with nothing in it. */
  empty: string
  copy?: Partial<CopyButtonText>
}

export const fileArtifactText: FileArtifactText = {
  lines: (n) => `${n} lines`,
  open: 'Open in editor',
  readMore: 'Read in the panel',
  empty: 'Empty file',
}

export type FileArtifactProps = RootProps<
  'article',
  {
    path: string
    /** What kind of file: Markdown, CSV. */
    kind: string
    size?: string
    lines?: number
    /** Its contents, as markdown: the preview, and what the panel shows. Without it, there is no preview. */
    body?: string
    /** Its contents are still being read: the preview's place shows, without words. */
    loading?: boolean
    /** Its contents couldn't be read, in words: shown where the preview would be. */
    error?: string
    /** How many blocks the preview shows. */
    preview?: number
    /** Open it in the editor. Without it, there is no Open. */
    onOpen?: () => void
    text?: Partial<FileArtifactText>
  }
>

/**
 * A file it wrote: what it is, where it lives, how big, and a way in. A
 * document's preview opens it in the side panel when the shell can open
 * documents; the whole preview is the button's target, though the button
 * holds only its words. A file with nothing to preview is its head alone.
 */
export function FileArtifact({
  path,
  kind,
  size,
  lines,
  body,
  loading = false,
  error,
  preview = 4,
  onOpen,
  text,
  className,
  ...rest
}: FileArtifactProps) {
  const t = { ...fileArtifactText, ...text }
  const { openDoc } = useThreadShell()
  const titleId = useId()
  const name = path.split('/').pop() ?? path
  const readable = body !== undefined && body.trim() !== '' && !loading && error === undefined
  const facts = [kind, size, lines === undefined ? undefined : t.lines(lines)].filter((fact) => fact !== undefined)
  let more: ReactNode = null
  if (openDoc && readable)
    more = (
      <button type="button" className={s.more} aria-describedby={titleId} onClick={() => openDoc({ path, body })}>
        <span className={s.pill}>
          {t.readMore}
          <Icon name="arrow" size={11} />
        </span>
      </button>
    )
  return (
    <article className={cx(s.art, className)} aria-labelledby={titleId} {...rest}>
      <div className={s.head}>
        <span className={s.icon}>
          <Icon name="file" size={14} />
        </span>
        <span className={s.main}>
          <span className={s.title} id={titleId}>
            {name}
          </span>
          <span className={s.meta}>
            {path.length > name.length && (
              <>
                <span className={s.dir}>{path.slice(0, -name.length)}</span> ·{' '}
              </>
            )}
            {facts.join(' · ')}
          </span>
        </span>
        <span className={s.actions}>
          {readable && <CopyButton value={body} text={t.copy} />}
          {onOpen && (
            <ActionButton icon="external" onClick={onOpen}>
              {t.open}
            </ActionButton>
          )}
        </span>
      </div>
      {loading ? (
        <div className={cx(s.preview, s.reading)} aria-busy="true">
          <Skeleton width="48%" height={11} />
          <Skeleton width="92%" />
          <Skeleton width="86%" />
        </div>
      ) : error !== undefined ? (
        <p className={s.said}>{error}</p>
      ) : body === undefined ? null : body.trim() === '' ? (
        <p className={s.said}>{t.empty}</p>
      ) : (
        <div className={cx(s.preview, openDoc && s.opens)}>
          <div className={s.fade}>
            <Markdown source={body} to={preview} headingLevel={4} />
          </div>
          {more}
        </div>
      )}
    </article>
  )
}
