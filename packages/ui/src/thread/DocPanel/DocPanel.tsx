import { useState, type KeyboardEvent } from 'react'

import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { CopyButton, type CopyButtonText } from '../../primitives/CopyButton/CopyButton'
import { Problem } from '../../primitives/Problem/Problem'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { Segmented } from '../../primitives/Segmented/Segmented'
import { DiffLineKind } from '../../foundations/vocabulary'
import { CodeLines } from '../Code/CodeLines'
import { Diff, type DiffLine } from '../Diff/Diff'
import { isMarkdownPath, markChanges } from '../Markdown/changes'
import { Markdown, type MarkdownFile } from '../Markdown/Markdown'
import type { DocRef } from '../Shell/Shell'
import { SidePanel, SidePanelBody, SidePanelTitle, sidePanelText, type SidePanelText } from '../../primitives/SidePanel/SidePanel'
import s from './DocPanel.module.css'

/** A document at reading width, in the side panel. */
export interface DocPanelText extends SidePanelText {
  open: string
  /** A document with nothing in it. */
  empty: string
  /** A markdown file's two ways to show: as a page, or its source. */
  show: string
  rendered: string
  renderedTip: string
  source: string
  sourceTip: string
  /** The key between them. */
  showKey: string
  copy?: Partial<CopyButtonText>
}

export const docPanelText: DocPanelText = {
  ...sidePanelText,
  open: 'Open in editor',
  empty: 'Nothing in this document.',
  show: 'Show',
  rendered: 'Rendered',
  renderedTip: 'As a page, with what the task changed marked',
  source: 'Source',
  sourceTip: 'The markdown, as written',
  showKey: 'm',
}

export interface DocPanelProps {
  doc: DocRef
  onClose: () => void
  /** Open the document in the editor. Without it, there is no such button. */
  onOpen?: () => void
  /** The document is still being read: its lines' places show, without words. */
  loading?: boolean
  /** The document couldn't be read, in words: shown in its place. */
  error?: string
  /** Where the document is, so the pictures it names beside it can be drawn. */
  file?: MarkdownFile
  /**
   * What the task changed in the file, as the diff of the whole of it (never one in hunks), so the page can mark it.
   * Undefined while it is read, null where it couldn't be or there is none: the page is then shown as it is.
   */
  change?: readonly DiffLine[] | null
  text?: Partial<DocPanelText>
}

export function DocPanel({ doc, onClose, onOpen, loading = false, error, file, change, text }: DocPanelProps) {
  const t = { ...docPanelText, ...text }
  // A markdown file is a page first, and its source a press away; a document with no file behind it is only its words.
  const [way, setWay] = useState<'rendered' | 'source'>('rendered')
  const page = doc.path !== undefined && isMarkdownPath(doc.path)
  const marked = change == null ? null : markChanges(change)
  // Its source is what the task changed in it, as a diff, where it changed it; the file's lines as they are, where it didn't.
  const diff = change?.some((line) => line.kind === DiffLineKind.Added || line.kind === DiffLineKind.Removed) ? change : null
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (!page || event.key !== t.showKey || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
    const target = event.target as HTMLElement
    if (target.isContentEditable || target.closest('input, textarea, select') !== null) return
    event.preventDefault()
    setWay(way === 'rendered' ? 'source' : 'rendered')
  }
  const name = (doc.path ? doc.path.split('/').pop() : doc.title) ?? ''
  const readable = !loading && error === undefined && doc.body.trim() !== ''
  return (
    <SidePanel
      label={name}
      onClose={onClose}
      onKeyDown={keys}
      text={t}
      head={
        <>
          <SidePanelTitle>{name}</SidePanelTitle>
          {doc.path && <span className={s.path}>{doc.path}</span>}
        </>
      }
      actions={
        <>
          {page && readable && (
            <Segmented<'rendered' | 'source'>
              label={t.show}
              value={way}
              onChange={setWay}
              options={[
                { value: 'rendered', label: t.rendered, tooltip: { label: t.renderedTip, kbd: t.showKey } },
                { value: 'source', label: t.source, tooltip: { label: t.sourceTip, kbd: t.showKey } },
              ]}
            />
          )}
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
          <Problem banner className={s.problem}>
            {error}
          </Problem>
        ) : readable && page && way === 'source' && diff !== null ? (
          <Diff lines={diff} label={doc.path ?? ''} path={doc.path ?? ''} fold={4} oldNumbers />
        ) : readable && page && way === 'source' ? (
          <CodeLines path={doc.path ?? ''} read={{ text: doc.body, from: 1, total: doc.body.split('\n').length, cut: false }} />
        ) : readable ? (
          <Markdown
            source={marked?.source ?? doc.body}
            size="panel"
            {...(marked === null ? {} : { marks: marked.marks })}
            {...(file === undefined ? {} : { file })}
          />
        ) : (
          <p className={s.said}>{t.empty}</p>
        )}
      </SidePanelBody>
    </SidePanel>
  )
}
