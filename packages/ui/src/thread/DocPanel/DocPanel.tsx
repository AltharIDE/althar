import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Markdown } from '../Markdown/Markdown'
import type { DocRef } from '../Shell/Shell'
import { SidePanel, SidePanelBody, SidePanelTitle, sidePanelText, type SidePanelText } from '../../primitives/SidePanel/SidePanel'
import s from './DocPanel.module.css'

/** A document at reading width, in the side panel. */
export interface DocPanelText extends SidePanelText {
  open: string
  copy?: Partial<CopyButtonText>
}

export const docPanelText: DocPanelText = { ...sidePanelText, open: 'Open in editor' }

export interface DocPanelProps {
  doc: DocRef
  onClose: () => void
  /** Open the document in the editor. Without it, there is no such button. */
  onOpen?: () => void
  text?: Partial<DocPanelText>
}

export function DocPanel({ doc, onClose, onOpen, text }: DocPanelProps) {
  const t = { ...docPanelText, ...text }
  const name = (doc.path ? doc.path.split('/').pop() : doc.title) ?? ''
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
          <CopyButton value={doc.body} text={t.copy} />
          {onOpen && (
            <ActionButton icon="external" onClick={onOpen}>
              {t.open}
            </ActionButton>
          )}
        </>
      }
    >
      <SidePanelBody>
        <Markdown source={doc.body} size="panel" />
      </SidePanelBody>
    </SidePanel>
  )
}
