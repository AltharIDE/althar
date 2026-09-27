import { Icon } from '../../foundations/Icon/Icon'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Markdown } from '../Markdown/Markdown'
import { useShell } from '../Shell/Shell'
import s from './FileArtifact.module.css'

export interface FileArtifactText {
  lines: (n: number) => string
  open: string
  openTitle: string
  read: (name: string) => string
  readMore: string
  copy?: Partial<CopyButtonText>
}

export const fileArtifactText: FileArtifactText = {
  lines: (n) => `${n} lines`,
  open: 'Open',
  openTitle: 'Open in the editor',
  read: (name) => `Read ${name} in the side panel`,
  readMore: 'Read in the panel',
}

export interface FileArtifactProps {
  path: string
  /** What kind of file: Markdown, CSV. */
  kind: string
  size: string
  lines: number
  /** Its contents, as markdown blocks. */
  body: string[]
  /** Open it in the editor. Without it, there is no Open. */
  onOpen?: () => void
  text?: Partial<FileArtifactText>
}

/** A file it wrote: what it is, where it lives, how big, and a way in. The preview opens it in the side panel. */
export function FileArtifact({ path, kind, size, lines, body, onOpen, text }: FileArtifactProps) {
  const t = { ...fileArtifactText, ...text }
  const { openDoc } = useShell()
  const name = path.split('/').pop() ?? path
  return (
    <article className={s.art} aria-label={name}>
      <div className={s.head}>
        <span className={s.icon}>
          <Icon name="file" size={14} />
        </span>
        <span className={s.main}>
          <span className={s.title}>{name}</span>
          <span className={s.meta}>
            <span className={s.dir}>{path.slice(0, -name.length)}</span> · {kind} · {size} · {t.lines(lines)}
          </span>
        </span>
        <span className={s.actions}>
          <CopyButton value={body.join('\n\n')} text={t.copy} />
          {onOpen && (
            <ActionButton icon="external" onClick={onOpen} title={t.openTitle}>
              {t.open}
            </ActionButton>
          )}
        </span>
      </div>
      <button type="button" className={s.preview} onClick={() => openDoc({ path, body })} aria-label={t.read(name)}>
        <span className={s.fade}>
          <Markdown blocks={body.slice(0, 4)} />
        </span>
        <span className={s.more} aria-hidden="true">
          {t.readMore}
          <Icon name="arrow" size={11} />
        </span>
      </button>
    </article>
  )
}
