import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Markdown } from '../Markdown/Markdown'
import type { DocRef } from '../Shell/Shell'
import { SidePanel, SidePanelBody, SidePanelTitle } from '../../primitives/SidePanel/SidePanel'
import s from './DocPanel.module.css'

/** A document at reading width, in the side panel. */
export interface DocPanelText {
  open: string
  close: string
  closeTitle: string
  copy?: Partial<CopyButtonText>
}

export const docPanelText: DocPanelText = { open: 'Open in editor', close: 'Close the panel', closeTitle: 'Close  esc' }

export interface DocPanelProps {
  doc: DocRef
  onClose: () => void
  /** Open the document in the editor. Without it, there is no such button. */
  onOpen?: () => void
  text?: Partial<DocPanelText>
}

export function DocPanel({ doc, onClose, onOpen, text }: DocPanelProps) {
  const t = { ...docPanelText, ...text }
  const name = doc.path ? doc.path.split('/').pop() : doc.title
  return (
    <SidePanel
      label={name ?? ''}
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
          <CopyButton value={doc.body.join('\n\n')} text={t.copy} />
          {onOpen && (
            <ActionButton icon="external" onClick={onOpen}>
              {t.open}
            </ActionButton>
          )}
        </>
      }
    >
      <SidePanelBody>
        <Markdown blocks={doc.body} size="panel" />
      </SidePanelBody>
    </SidePanel>
  )
}
