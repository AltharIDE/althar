import { useId, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Markdown } from '../Markdown/Markdown'
import { useThreadShell } from '../Shell/Shell'
import s from './FileArtifact.module.css'

export interface FileArtifactText {
  lines: (n: number) => string
  open: string
  readMore: string
  copy?: Partial<CopyButtonText>
}

export const fileArtifactText: FileArtifactText = {
  lines: (n) => `${n} lines`,
  open: 'Open in editor',
  readMore: 'Read in the panel',
}

export type FileArtifactProps = RootProps<
  'article',
  {
    path: string
    /** What kind of file: Markdown, CSV. */
    kind: string
    size: string
    lines: number
    /** Its contents, as markdown. */
    body: string
    /** How many blocks the preview shows. */
    preview?: number
    /** Open it in the editor. Without it, there is no Open. */
    onOpen?: () => void
    text?: Partial<FileArtifactText>
  }
>

/**
 * A file it wrote: what it is, where it lives, how big, and a way in. The
 * preview opens it in the side panel when the shell can open documents; the
 * whole preview is the button's target, though the button holds only its words.
 */
export function FileArtifact({ path, kind, size, lines, body, preview = 4, onOpen, text, className, ...rest }: FileArtifactProps) {
  const t = { ...fileArtifactText, ...text }
  const { openDoc } = useThreadShell()
  const titleId = useId()
  const name = path.split('/').pop() ?? path
  let more: ReactNode = null
  if (openDoc)
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
            <span className={s.dir}>{path.slice(0, -name.length)}</span> · {kind} · {size} · {t.lines(lines)}
          </span>
        </span>
        <span className={s.actions}>
          <CopyButton value={body} text={t.copy} />
          {onOpen && (
            <ActionButton icon="external" onClick={onOpen}>
              {t.open}
            </ActionButton>
          )}
        </span>
      </div>
      <div className={cx(s.preview, openDoc && s.opens)}>
        <div className={s.fade}>
          <Markdown source={body} to={preview} headingLevel={4} />
        </div>
        {more}
      </div>
    </article>
  )
}
