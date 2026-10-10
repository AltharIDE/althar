import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { Markdown } from '../Markdown/Markdown'
import type { DocRef } from '../Shell/Shell'
import { SidePanel, SidePanelBody, SidePanelTitle, sidePanelText, type SidePanelText } from '../../primitives/SidePanel/SidePanel'
import s from './DocPanel.module.css'

/** A document at reading width, in the side panel. */
export interface DocPanelText extends SidePanelText {
  open: string
  /** A document with nothing in it. */
  empty: string
  copy?: Partial<CopyButtonText>
}

export const docPanelText: DocPanelText = { ...sidePanelText, open: 'Open in editor', empty: 'Nothing in this document.' }

export interface DocPanelProps {
  doc: DocRef
  onClose: () => void
  /** Open the document in the editor. Without it, there is no such button. */
  onOpen?: () => void
  /** The document is still being read: its lines' places show, without words. */
  loading?: boolean
  /** The document couldn't be read, in words: shown in its place. */
  error?: string
  text?: Partial<DocPanelText>
}

export function DocPanel({ doc, onClose, onOpen, loading = false, error, text }: DocPanelProps) {
  const t = { ...docPanelText, ...text }
  const name = (doc.path ? doc.path.split('/').pop() : doc.title) ?? ''
  const readable = !loading && error === undefined && doc.body.trim() !== ''
  return (
    <SidePanel
      label={name}
      onClose={onClose}
      text={t}
      head={
        <>
          <SidePanelTitle>{name}</SidePanelTitle>
          {doc.path && <span className={s.path}>{doc.path}</span>}
        </>
      }
      actions={
        <>
          {readable && <CopyButton value={doc.body} text={t.copy} />}
          {onOpen && (
            <ActionButton icon="external" onClick={onOpen}>
              {t.open}
            </ActionButton>
          )}
        </>
      }
    >
      <SidePanelBody>
        {loading ? (
          <div className={s.reading} aria-busy="true">
            <Skeleton width="54%" height={14} />
            <Skeleton width="96%" />
            <Skeleton width="91%" />
            <Skeleton width="72%" />
          </div>
        ) : error !== undefined ? (
          <p className={s.said}>{error}</p>
        ) : readable ? (
          <Markdown source={doc.body} size="panel" />
        ) : (
          <p className={s.said}>{t.empty}</p>
        )}
      </SidePanelBody>
    </SidePanel>
  )
}
