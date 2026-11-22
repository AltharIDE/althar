import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  BOARDS_ENTRY,
  CANVAS_LIMITS,
  canvasAddress,
  type CanvasBoards,
  type CanvasManifest,
  isReservedCanvasPath,
  readBoards,
} from '@althar/contracts'
import { artifactPath, isDigest } from '@althar/runtime/artifacts'

import type { CanvasTarget } from './views'

const DEVICE = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])\s*(?:\.|$)/i
const FORBIDDEN = /[<>:"/\\|?*\p{Cc}\p{Cs}]/u

/** A person's label can contain characters that would be a path or a device on some systems. */
export const safeName = (label: string): string => {
  const clean = Array.from(label.trim().normalize('NFC'))
    .slice(0, 60)
    .map((part) => (FORBIDDEN.test(part) ? '_' : part))
    .join('')
    .replace(/[. ]+$/, '')
  return DEVICE.test(clean) ? `_${clean}` : clean || 'Untitled'
}

/** Source paths must survive unchanged, including when saved on Windows. */
export const safeStoredPath = (path: string): boolean =>
  path.split('/').every((part) => part !== '' && !/[. ]$/.test(part) && !FORBIDDEN.test(part) && !DEVICE.test(part))

/** Reserve the folder with mkdir so concurrent downloads cannot choose the same one. */
export const reserveFolder = async (parent: string, name: string): Promise<string> => {
  const base = safeName(name)
  for (let index = 1; ; index++) {
    const path = join(parent, index === 1 ? base : `${base}-${index}`)
    try {
      await mkdir(path, { mode: 0o700 })
      return path
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code !== 'EEXIST') throw failure
    }
  }
}

const distinct = (label: string, used: Set<string>) => {
  const base = safeName(label)
  let name = base
  for (let index = 2; used.has(name.toLowerCase()); index++) name = `${base}-${index}`
  used.add(name.toLowerCase())
  return name
}

/** Keep boards in their published order and give each its own file on case-insensitive disks. */
export const boardOutputs = (boards: CanvasBoards) => {
  const pages = new Set<string>()
  return boards.pages.flatMap(({ name, boards }) => {
    const page = distinct(name, pages)
    const names = new Set<string>()
    return boards.map((board) => ({ board, page, name: `${distinct(board.name, names)}.png` }))
  })
}

export const BOARD_PRINT = '.althar/print.html'

export const storedBoards = async (root: string, manifest: CanvasManifest) => {
  if (manifest.entry !== BOARDS_ENTRY) return null
  const entry = manifest.files.find(({ path }) => path === manifest.entry)
  if (entry === undefined || !isDigest(entry.sha256) || entry.size > CANVAS_LIMITS.text) return null
  const bytes = await readFile(artifactPath(root, entry.sha256)).catch(() => null)
  if (bytes === null || bytes.length > CANVAS_LIMITS.text) return null
  const paths = new Set(manifest.files.filter((file) => isDigest(file.sha256)).map((file) => file.path))
  const read = readBoards(
    bytes.toString('utf8'),
    (path) =>
      paths.has(path) &&
      !isReservedCanvasPath(path) &&
      path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !/\p{Cs}/u.test(part)),
  )
  return read.ok ? read.boards : null
}

export const boardPrintAt = async (root: string, manifest: CanvasManifest, asked: { host: string; version: number }, address: string) => {
  const index = new URL(address).searchParams.get('board')
  if (index !== null && !/^\d{1,3}$/.test(index)) return null
  const boards = await storedBoards(root, manifest)
  if (boards === null) return null
  return boardPrint({ canvasId: `cnv_${asked.host}`, version: asked.version }, boards, index === null ? undefined : Number(index))
}

/** The same board viewport is used on paper and in a screenshot. */
export const boardPrint = (target: Pick<CanvasTarget, 'canvasId' | 'version'>, boards: CanvasBoards, index?: number): string | null => {
  const all = boards.pages.flatMap((page) => page.boards)
  const chosen = index === undefined ? all : all.slice(index, index + 1)
  if (chosen.length === 0) return null
  const styles = chosen.map(
    ({ width, height }, i) =>
      `@page board${i} { size: ${width}px ${height}px; margin: 0; }
     #board${i} { page: board${i}; width: ${width}px; height: ${height}px; }`,
  )
  const sections = chosen.map(({ file }, i) => {
    const src = canvasAddress(target.canvasId, target.version, file)
    const content = /\.html?$/i.test(file) ? `<iframe src="${src}" scrolling="no"></iframe>` : `<img src="${src}" alt="">`
    return `<section id="board${i}">${content}</section>`
  })
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; }
    html, body { margin: 0; padding: 0; }
    section { overflow: hidden; }
    iframe, img { display: block; border: 0; width: 100%; height: 100%; }
    img { object-fit: contain; }
    @media print {
      section + section { break-before: page; }
      section { break-inside: avoid; }
    }
    ${styles.join('\n')}
  </style></head><body>${sections.join('\n')}</body></html>`
}
