import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CanvasesHost } from '../src/renderer/data/services'
import { DownloadCanvas, formatWords } from '../src/renderer/features/canvases/DownloadCanvas'
import { fakeClient, fakeHost } from './fixtures'
import { withServices } from './render'

/*
 * Download, in an artifact's head (ADR-104): the formats its kind offers, the
 * one most wanted first; the version shown asked for, a diagram's SVG the one
 * drawn in the panel; busy while the main process draws it; a download that
 * failed says why, with Try again.
 */

const CANVAS = `cnv_${'c3'.repeat(16)}`
const PROJECT = `proj_${'b2'.repeat(16)}`
const MANIFEST = '3'.repeat(64)

afterEach(() => {
  for (const left of document.body.querySelectorAll(':scope > [role="dialog"], :scope > [role="menu"]')) left.remove()
})

const hostWith = (download: CanvasesHost['download']) => {
  const canvases: CanvasesHost = {
    show: vi.fn(),
    close: vi.fn(),
    reload: vi.fn(),
    still: vi.fn(async () => null),
    cover: vi.fn(async () => {}),
    ...(download === undefined ? {} : { download }),
  }
  return fakeHost({ canvases })
}

describe('downloading an artifact', () => {
  it('offers the formats its kind downloads as, and asks for the version shown', async () => {
    const download = vi.fn<NonNullable<CanvasesHost['download']>>(async () => ({ kind: 'saved', path: '/Downloads/gift-a-class.pdf' }))
    withServices(
      <DownloadCanvas
        projectId={PROJECT}
        canvasId={CANVAS}
        name="gift-a-class"
        kind="boards"
        version={2}
        manifest={MANIFEST}
        body={null}
      />,
      fakeClient().client,
      hostWith(download),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((one) => one.textContent)).toEqual(['PNG, a board eacha folder', 'PDF, a page a board.pdf', 'Its filesa folder'])
    await userEvent.click(screen.getByRole('menuitem', { name: /PDF, a page a board/ }))
    expect(download).toHaveBeenCalledWith({
      projectId: PROJECT,
      canvasId: CANVAS,
      version: 2,
      manifest: MANIFEST,
      name: 'gift-a-class',
      kind: 'boards',
      format: 'pdf',
    })
    // Busy while the main process draws it, then ready again.
    expect(await screen.findByRole('button', { name: 'Download' })).toBeTruthy()
  })

  it('sends a diagram as it is drawn in the panel', async () => {
    const download = vi.fn<NonNullable<CanvasesHost['download']>>(async () => ({ kind: 'cancelled' }))
    const body = document.createElement('div')
    body.innerHTML = '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'
    withServices(
      <DownloadCanvas projectId={PROJECT} canvasId={CANVAS} name="sign-in" kind="mermaid" version={1} manifest={MANIFEST} body={body} />,
      fakeClient().client,
      hostWith(download),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^SVG/ }))
    const asked = download.mock.calls[0]?.[0]
    expect(asked?.format).toBe('svg')
    expect(asked?.svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(asked?.svg).toContain('<rect')
    // Its words are the source: nothing drawn goes with them.
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /The diagram’s words/ }))
    expect(download.mock.calls[1]?.[0]).not.toHaveProperty('svg')
  })

  it('says why a download failed, and tries again', async () => {
    const download = vi
      .fn<NonNullable<CanvasesHost['download']>>()
      .mockResolvedValueOnce({ kind: 'failed', why: 'The folder can’t be written to.' })
      .mockResolvedValueOnce({ kind: 'saved', path: '/Downloads/login.png' })
    withServices(
      <DownloadCanvas projectId={PROJECT} canvasId={CANVAS} name="login" kind="html" version={4} manifest={MANIFEST} body={null} />,
      fakeClient().client,
      hostWith(download),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^PNG/ }))
    expect(await screen.findByText('The folder can’t be written to.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(download).toHaveBeenCalledTimes(2)
    expect(download.mock.calls[1]?.[0].format).toBe('png')
    expect(await screen.findByRole('button', { name: 'Download' })).toBeTruthy()
  })

  it('isn’t offered where the window can’t save files', () => {
    withServices(
      <DownloadCanvas projectId={PROJECT} canvasId={CANVAS} name="login" kind="html" version={1} manifest={MANIFEST} body={null} />,
      fakeClient().client,
      hostWith(undefined),
    )
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
  })

  it('names each format for what it saves', () => {
    expect(formatWords('markdown', 'source')).toEqual(['Markdown', '.md'])
    expect(formatWords('picture', 'source')).toEqual(['The picture', ''])
    expect(formatWords('html', 'png')).toEqual(['PNG', '.png'])
    expect(formatWords('boards', 'png')).toEqual(['PNG, a board each', 'a folder'])
    expect(formatWords('svg', 'png')).toEqual(['PNG', '.png'])
  })
})
