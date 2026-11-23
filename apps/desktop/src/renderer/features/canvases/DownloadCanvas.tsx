import { useState } from 'react'

import { CANVAS_DOWNLOADS, type CanvasDownloadFormat, type CanvasKind } from '@althar/contracts'
import { Button, IconButton, Menu, MenuItem, Popover } from '@althar/ui'

import { useServices } from '../../data/services'
import s from './DownloadCanvas.module.css'

/*
 * Download, in an artifact's head (ADR-104): the version shown, as the
 * formats its kind offers, the one most wanted first. The press opens where
 * to save it at once; drawing a PNG or a PDF goes on in the main process
 * after, the button busy meanwhile. A download that failed says why, with
 * Try again.
 */

export const text = {
  label: 'Download',
  busy: 'Downloading…',
  failed: 'Couldn’t download it',
  again: 'Try again',
  formats: {
    source: {
      markdown: ['Markdown', '.md'],
      mermaid: ['The diagram’s words', '.mmd'],
      svg: ['SVG', '.svg'],
      picture: ['The picture', ''],
      html: ['Its source', ''],
      boards: ['Its source', ''],
    },
    files: ['Its files', 'a folder'],
    png: ['PNG', '.png'],
    pdf: ['PDF', '.pdf'],
    svg: ['SVG', '.svg'],
  },
  boards: { png: ['PNG, a board each', 'a folder'], pdf: ['PDF, a page a board', '.pdf'] },
} as const

/** What a format is called in the menu, and what it saves as. */
export const formatWords = (kind: CanvasKind, format: CanvasDownloadFormat): readonly [string, string] =>
  format === 'source'
    ? text.formats.source[kind]
    : kind === 'boards' && (format === 'png' || format === 'pdf')
      ? text.boards[format]
      : text.formats[format]

export interface DownloadCanvasProps {
  projectId: string
  canvasId: string
  name: string
  kind: CanvasKind
  version: number
  manifest: string
  /** Where the canvas is drawn in the panel: a diagram's SVG is the one drawn there. */
  body: HTMLElement | null
}

export function DownloadCanvas({ projectId, canvasId, name, kind, version, manifest, body }: DownloadCanvasProps) {
  const { host } = useServices()
  const download = host.canvases?.download
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<{ readonly why: string; readonly format: CanvasDownloadFormat } | null>(null)
  if (download === undefined) return null

  const start = (format: CanvasDownloadFormat) => {
    setFailed(null)
    // A diagram is drawn in the window, so its SVG goes with the request.
    const drawn = kind === 'mermaid' && format !== 'source' ? body?.querySelector('svg') : null
    const svg = drawn === null || drawn === undefined ? undefined : new XMLSerializer().serializeToString(drawn)
    setBusy(true)
    void download({ projectId, canvasId, version, manifest, name, kind, format, ...(svg === undefined ? {} : { svg }) })
      .then((done) => {
        if (done.kind === 'failed') setFailed({ why: done.why, format })
      })
      .catch(() => setFailed({ why: text.failed, format }))
      .finally(() => setBusy(false))
  }

  const formats = CANVAS_DOWNLOADS[kind]
  if (busy) return <IconButton icon="download" label={text.busy} size="small" busy />
  if (failed !== null)
    return (
      <Popover
        label={text.failed}
        trigger={<IconButton icon="problem" label={text.failed} size="small" tone="danger" />}
        defaultOpen
        onOpenChange={(open) => {
          if (!open) setFailed(null)
        }}
        align="end"
      >
        <div className={s.failed}>
          <p>{failed.why}</p>
          {/* oxlint-disable-next-line althar/press-at-once -- its result is the system's save dialog, which opens at once; the answer only says why a download failed */}
          <Button size="small" onClick={() => start(failed.format)}>
            {text.again}
          </Button>
        </div>
      </Popover>
    )
  return (
    <Menu label={text.label} trigger={<IconButton icon="download" label={text.label} size="small" />} align="end" width={220}>
      {formats.map((format) => {
        const [words, hint] = formatWords(kind, format)
        return (
          // oxlint-disable-next-line althar/press-at-once -- its result is the system's save dialog, which opens at once; the answer only says why a download failed
          <MenuItem key={format} {...(hint === '' ? {} : { hint })} onSelect={() => start(format)}>
            {words}
          </MenuItem>
        )
      })}
    </Menu>
  )
}
