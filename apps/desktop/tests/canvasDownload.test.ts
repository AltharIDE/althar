// @vitest-environment node
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readBoards } from '@althar/contracts'
import { removeTree } from '@althar/testing'
import { describe, expect, it } from 'vitest'

import { boardOutputs, boardPrint, reserveFolder, safeName, safeStoredPath } from '../src/main/canvases/downloadFiles'

const target = { canvasId: `cnv_${'ab'.repeat(16)}`, version: 3 }

describe('canvas download names', () => {
  it('makes labels safe on every OS and keeps portable source paths as they are', () => {
    expect(safeName('  Week / Night:  ')).toBe('Week _ Night_')
    expect(safeName('...')).toBe('Untitled')
    expect(safeName('NuL.txt')).toBe('_NuL.txt')
    expect(safeName('COM¹')).toBe('_COM¹')
    expect(safeStoredPath('assets/last look.png')).toBe(true)
    for (const path of [
      '',
      '/',
      '../secret',
      'x/../secret',
      'x/./secret',
      '/tmp/secret',
      'x//secret',
      'x/',
      'C:secret',
      'x/NUL.txt',
      'x/name.',
      'x/name ',
      'x/file:stream',
      'x\\y',
      '\\server\\share',
    ]) {
      expect(safeStoredPath(path), path).toBe(false)
    }
  })

  it('reserves a new folder even when two downloads ask for the same name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'althar-download-'))
    try {
      await mkdir(join(root, 'login'))
      await writeFile(join(root, 'login-2'), '')
      const paths = await Promise.all([reserveFolder(root, 'login'), reserveFolder(root, 'login')])
      expect(paths.toSorted()).toEqual([join(root, 'login-3'), join(root, 'login-4')])
    } finally {
      await removeTree(root)
    }
  })
})

const read = readBoards(
  JSON.stringify({
    pages: [
      {
        name: 'Desk/top',
        boards: [
          { name: 'Mockup?', file: 'dark & light.html', width: 1440, height: 900 },
          { name: 'mockup*', file: 'poster.svg', width: 420, height: 640 },
        ],
      },
      { name: 'desk:top', boards: [{ name: 'COM1', file: 'narrow.html', width: 390, height: 844 }] },
    ],
  }),
  () => true,
)
if (!read.ok) throw new Error(read.why)
const outputs = boardOutputs(read.boards)

describe('downloading boards', () => {
  it('plans a PNG per board with distinct page and board names', () => {
    expect(outputs.map(({ page, name, board }) => [page, name, board.file])).toEqual([
      ['Desk_top', 'Mockup_.png', 'dark & light.html'],
      ['Desk_top', 'mockup_-2.png', 'poster.svg'],
      ['desk_top-2', '_COM1.png', 'narrow.html'],
    ])
  })

  it('puts each board on a named page at its own size and can draw just one board', () => {
    const html = boardPrint(target, read.boards)
    expect(html).toContain('@page board0 { size: 1440px 900px; margin: 0; }')
    expect(html).toContain('@page board1 { size: 420px 640px; margin: 0; }')
    expect(html).toContain('@page board2 { size: 390px 844px; margin: 0; }')
    expect(html?.match(/<section /g)).toHaveLength(3)
    expect(html).toContain('break-before: page')
    expect(html).toContain('/v3/dark%20%26%20light.html')
    expect(html).toContain('<img ')
    expect(boardPrint(target, read.boards, 1)?.match(/<section /g)).toHaveLength(1)
    expect(boardPrint(target, read.boards, 3)).toBeNull()
  })
})
