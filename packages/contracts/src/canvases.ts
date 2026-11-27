import { Schema } from 'effect'

/*
 * A project's canvases (ADR-104), as every side reads them: the runtime keeps
 * them, the main process serves an HTML canvas's files at its address, and
 * the window draws the rest and lists them. A canvas is a name in a project
 * with a version for each time an agent published it; a version is a
 * manifest of files by digest, which never changes, so an address always
 * gives the same bytes. Pure, so each side shares the names, kinds, limits
 * and addresses rather than restating them.
 */

/** How a canvas is drawn, told by its entry's extension; a canvas of boards by its entry, `canvas.json`. */
export const CanvasKind = Schema.Literals(['markdown', 'mermaid', 'svg', 'picture', 'html', 'boards'])
export type CanvasKind = typeof CanvasKind.Type

/** What one version may hold: as many files and bytes as one message's folder (MESSAGE_FILES), and a text the window reads whole. */
export const CANVAS_LIMITS = {
  files: 2000,
  /** Bytes in all of a version's files. */
  bytes: 100 * 1024 * 1024,
  /** Bytes in one file. */
  file: 50 * 1024 * 1024,
  /** Bytes of a Markdown, Mermaid or SVG entry the window reads to draw. */
  text: 2 * 1024 * 1024,
  /** A name's and a group's characters. */
  name: 60,
  /** A title's characters. */
  title: 120,
  /** A note's characters, and a comment's. */
  note: 2000,
} as const

/** A canvas's name, and a group's: lowercase words and hyphens, as an agent and the person can say it (`login-flow`). */
export const isCanvasName = (name: string) => name.length <= CANVAS_LIMITS.name && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)

/** The path under a version's address where Althar's own ground for a canvas of boards is served. */
export const BOARDS_GROUND = '.althar/boards.html'

/** Where an agent's working copies are, in the folder it starts from. */
export const CANVASES_FOLDER = '.althar/canvases'

/** A path inside a canvas that is Althar's own, which a publish refuses. */
export const isReservedCanvasPath = (path: string) => path === '.althar' || path.startsWith('.althar/')

const EXTENSION = /\.([a-z0-9]+)$/

const extensionOf = (path: string) => EXTENSION.exec(path.toLowerCase())?.[1] ?? ''

/** How a canvas whose entry is at `path` is drawn; null for an entry Althar can't draw. */
export const canvasKindOf = (path: string): CanvasKind | null => {
  if (path === BOARDS_ENTRY) return 'boards'
  switch (extensionOf(path)) {
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'mmd':
    case 'mermaid':
      return 'mermaid'
    case 'svg':
      return 'svg'
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return 'picture'
    case 'html':
    case 'htm':
      return 'html'
    default:
      return null
  }
}

const TYPES: Readonly<Record<string, string>> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  mmd: 'text/plain; charset=utf-8',
  mermaid: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  wasm: 'application/wasm',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
}

/*
 * A canvas of boards: designs laid side by side on pages, as a design tool
 * lays out frames, each board a file of the canvas (a page or a picture)
 * drawn at the size its agent gave it. Its entry, `canvas.json`, says which
 * pages it has and which boards are on each; the boards are the canvas's own
 * files, so pointing at a part of one reaches it. One page may be written
 * as its boards alone.
 */

/** The entry of a canvas of boards. */
export const BOARDS_ENTRY = 'canvas.json'

export const BOARDS_LIMITS = {
  pages: 40,
  /** Boards in all of a canvas's pages. */
  boards: 120,
  /** A page's and a board's name, in characters. */
  name: 80,
  /** A board's width and height, in CSS pixels. */
  smallest: 120,
  largest: 10_000,
} as const

/** What a board can be: a page of its own, or a picture. */
const BOARD_FILE = /\.(html?|svg|png|jpe?g|gif|webp|avif)$/i

/** A board: its name, the file of the canvas drawn on it, and the size it is drawn at. */
export const CanvasBoard = Schema.Struct({ name: Schema.String, file: Schema.String, width: Schema.Number, height: Schema.Number })
export type CanvasBoard = typeof CanvasBoard.Type

export const CanvasBoardsPage = Schema.Struct({ name: Schema.String, boards: Schema.Array(CanvasBoard) })
export type CanvasBoardsPage = typeof CanvasBoardsPage.Type

/** A canvas of boards, its pages in order. */
export const CanvasBoards = Schema.Struct({ pages: Schema.Array(CanvasBoardsPage) })
export type CanvasBoards = typeof CanvasBoards.Type

export type ReadBoards = { readonly ok: true; readonly boards: CanvasBoards } | { readonly ok: false; readonly why: string }

const isRecordOf = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * A canvas of boards read from its entry's words, checked against the files
 * it holds (`has`): each page named, each board named once on its page, its
 * file one of the canvas's pages or pictures, and its size whole pixels in
 * bounds. What is wrong is said for the agent that wrote it.
 */
export const readBoards = (words: string, has: (path: string) => boolean): ReadBoards => {
  let said: unknown
  try {
    said = JSON.parse(words)
  } catch {
    return { ok: false, why: `${BOARDS_ENTRY} isn’t JSON.` }
  }
  if (!isRecordOf(said)) return { ok: false, why: `${BOARDS_ENTRY} is an object with pages, or with the boards of its one page.` }
  const listed = Array.isArray(said.pages)
    ? said.pages
    : Array.isArray(said.boards)
      ? [{ name: typeof said.name === 'string' && said.name.trim() !== '' ? said.name : 'Page 1', boards: said.boards }]
      : null
  if (listed === null || listed.length === 0)
    return {
      ok: false,
      why: `${BOARDS_ENTRY} has no pages: give it pages, each with a name and its boards, or the boards of its one page.`,
    }
  if (listed.length > BOARDS_LIMITS.pages)
    return { ok: false, why: `It has ${listed.length} pages; a canvas can have at most ${BOARDS_LIMITS.pages}.` }
  const pages: Array<CanvasBoardsPage> = []
  const pageNames = new Set<string>()
  let count = 0
  for (const [at, page] of listed.entries()) {
    if (!isRecordOf(page) || !Array.isArray(page.boards))
      return { ok: false, why: `Page ${at + 1} is an object with a name and its boards.` }
    const name = typeof page.name === 'string' ? page.name.trim() : ''
    if (name === '' || name.length > BOARDS_LIMITS.name)
      return { ok: false, why: `Page ${at + 1} needs a name of 1 to ${BOARDS_LIMITS.name} characters.` }
    if (pageNames.has(name)) return { ok: false, why: `Two pages are called ${name}; each page’s name is its own.` }
    pageNames.add(name)
    if (page.boards.length === 0) return { ok: false, why: `${name} has no boards.` }
    const boards: Array<CanvasBoard> = []
    const boardNames = new Set<string>()
    for (const [place, board] of page.boards.entries()) {
      const where = `Board ${place + 1} of ${name}`
      if (!isRecordOf(board)) return { ok: false, why: `${where} is an object with a name, a file, a width and a height.` }
      const title = typeof board.name === 'string' ? board.name.trim() : ''
      if (title === '' || title.length > BOARDS_LIMITS.name)
        return { ok: false, why: `${where} needs a name of 1 to ${BOARDS_LIMITS.name} characters.` }
      if (boardNames.has(title))
        return { ok: false, why: `Two boards on ${name} are called ${title}; each board’s name on a page is its own.` }
      boardNames.add(title)
      const file = typeof board.file === 'string' ? board.file.replace(/^\.\//, '') : ''
      if (file === '' || !BOARD_FILE.test(file))
        return {
          ok: false,
          why: `${title} on ${name} needs a file: a page (.html) or a picture (.svg, .png, .jpg, .gif, .webp, .avif) of the canvas.`,
        }
      if (!has(file)) return { ok: false, why: `${title} on ${name} is drawn from ${file}, which isn’t in the canvas.` }
      const size = (value: unknown) =>
        typeof value === 'number' && Number.isInteger(value) && value >= BOARDS_LIMITS.smallest && value <= BOARDS_LIMITS.largest
          ? value
          : null
      const width = size(board.width)
      const height = size(board.height)
      if (width === null || height === null)
        return {
          ok: false,
          why: `${title} on ${name} needs a width and a height in whole pixels, from ${BOARDS_LIMITS.smallest} to ${BOARDS_LIMITS.largest.toLocaleString('en')}, such as 1440 by 900 or 390 by 844.`,
        }
      boards.push({ name: title, file, width, height })
    }
    count += boards.length
    if (count > BOARDS_LIMITS.boards)
      return { ok: false, why: `It has more than ${BOARDS_LIMITS.boards} boards; a canvas can have at most that many.` }
    pages.push({ name, boards })
  }
  return { ok: true, boards: { pages } }
}

/** The type a file of a canvas is served as, by its extension; anything else as bytes. */
export const canvasMediaTypeOf = (path: string) => TYPES[extensionOf(path)] ?? 'application/octet-stream'

/** A file of a version: its path inside the canvas (with `/`), its digest in the artifact store, its size and its type. */
export const CanvasFile = Schema.Struct({ path: Schema.String, sha256: Schema.String, size: Schema.Number, type: Schema.String })
export type CanvasFile = typeof CanvasFile.Type

/** A version's manifest, kept in the artifact store by its own digest: the file drawn first, and every file, by path. */
export const CanvasManifest = Schema.Struct({ entry: Schema.String, files: Schema.Array(CanvasFile) })
export type CanvasManifest = typeof CanvasManifest.Type

/** The manifest's bytes: its files in path order, so the same files are always the same digest. */
export const manifestBytes = (manifest: CanvasManifest): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({
      entry: manifest.entry,
      files: manifest.files
        .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map((file) => ({ path: file.path, sha256: file.sha256, size: file.size, type: file.type })),
    }),
  )

/** The scheme an HTML canvas is served on, handled only in its project's canvas partition. */
export const CANVAS_SCHEME = 'althar-canvas'

/** A canvas's origin's host: its id's hex, as a host must be lowercase letters and digits. */
export const canvasHost = (canvasId: string) => canvasId.slice(canvasId.indexOf('_') + 1)

/** Where a file of a version is served: the canvas is the origin, the version the path under it. */
export const canvasAddress = (canvasId: string, version: number, path: string) =>
  `${CANVAS_SCHEME}://${canvasHost(canvasId)}/v${version}/${path.split('/').map(encodeURIComponent).join('/')}`

/** What an address names: the canvas's host, the version and the path in it; null for one that isn't a version's file. */
export const canvasAddressOf = (address: string): { readonly host: string; readonly version: number; readonly path: string } | null => {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return null
  }
  if (url.protocol !== `${CANVAS_SCHEME}:` || !/^[0-9a-f]{32}$/.test(url.hostname)) return null
  const found = /^\/v([1-9][0-9]{0,8})\/(.*)$/.exec(url.pathname)
  if (found === null) return null
  let path: string
  try {
    path = found[2] === '' ? '' : found[2]!.split('/').map(decodeURIComponent).join('/')
  } catch {
    return null
  }
  return { host: url.hostname, version: Number(found[1]), path }
}

/** The partition a project's canvas views run in, apart from its pages and from Althar's window. */
export const canvasPartitionOf = (projectId: string) => `persist:canvases-${projectId.slice(projectId.indexOf('_') + 1)}`

/** Where in a version a comment points: the whole of it, a passage of a document, an area of a picture, or an element of a page. */
export const CanvasAnchor = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('whole') }),
  Schema.Struct({
    kind: Schema.Literal('passage'),
    /** The words selected, cut to a few hundred characters. */
    text: Schema.String,
    /** The heading it is under, where it is under one. */
    heading: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal('area'),
    /** The area as shares of the picture, 0 to 1, from its top left. */
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  }),
  Schema.Struct({
    kind: Schema.Literal('element'),
    selector: Schema.String,
    label: Schema.String,
    text: Schema.String,
    /** On a canvas of boards, the page and the board it is on, by their names. */
    page: Schema.optional(Schema.String),
    board: Schema.optional(Schema.String),
  }),
])
export type CanvasAnchor = typeof CanvasAnchor.Type

/** A comment on a canvas, sent with a message: kept with it, in the same command, never before. */
export const SentCanvasComment = Schema.Struct({
  canvasId: Schema.String,
  version: Schema.Number,
  anchor: CanvasAnchor,
  body: Schema.String,
})
export type SentCanvasComment = typeof SentCanvasComment.Type

/** Who published a version: the task whose lead it was, or the coordinator. */
export const CanvasBy = Schema.Struct({
  /** A task's lead, the coordinator, or the artifact's own chat (`ArtifactChat`). */
  role: Schema.Literals(['lead', 'coordinator', 'chat']),
  taskId: Schema.NullOr(Schema.String),
  /** The task's title, as it is now; null for the coordinator. */
  taskTitle: Schema.NullOr(Schema.String),
  /** The conversation it was published from: a task's, an aside's or the coordinator's, where the artifact is talked about. */
  threadId: Schema.optional(Schema.String),
})
export type CanvasBy = typeof CanvasBy.Type

/** A version, as the canvas's bar and its list say it. */
export const CanvasVersionFacts = Schema.Struct({
  number: Schema.Number,
  base: Schema.NullOr(Schema.Number),
  title: Schema.String,
  kind: CanvasKind,
  entry: Schema.String,
  /** Its manifest's digest: what the main process serves its files from. */
  manifest: Schema.String,
  /** Its entry's digest in the artifact store: what the window draws a picture from. */
  entrySha256: Schema.String,
  note: Schema.NullOr(Schema.String),
  files: Schema.Number,
  bytes: Schema.Number,
  by: CanvasBy,
  at: Schema.String,
})
export type CanvasVersionFacts = typeof CanvasVersionFacts.Type

/*
 * Saving an artifact to a repository: a canvas lives in Althar until someone
 * saves it to a folder in one of the project's repositories, where it is in
 * git with everything else, for people who never open Althar. The project
 * keeps one place for its artifacts (a setting, which the first save makes);
 * Save to repo puts one there unless the person picks somewhere else. It
 * goes in a pull request of its own, or straight to the default branch, and
 * each new version is committed as it is published, or only the one saved.
 */

/** How a saved artifact goes into its repository: a pull request of its own, or straight to the default branch. */
export const ArtifactsHow = Schema.Literals(['pr', 'main'])
export type ArtifactsHow = typeof ArtifactsHow.Type

/** Where the project's artifacts go, as its setting says: a folder in one of its repositories, how, and whether each version is committed. */
export const ArtifactsHome = Schema.Struct({
  repositoryId: Schema.String,
  /** The repository's name, as the project shows it. */
  repository: Schema.String,
  /** A folder in it, with a trailing slash (`design/`); empty for its root. */
  folder: Schema.String,
  how: ArtifactsHow,
  /** Each new version committed as it is published; otherwise only the version someone saves. */
  follow: Schema.Boolean,
})
export type ArtifactsHome = typeof ArtifactsHome.Type

/** The project's place for artifacts, where it has one, and Althar's pick for the first save where it has none, with why. */
export const ArtifactsPlace = Schema.Struct({
  home: Schema.NullOr(ArtifactsHome),
  guess: Schema.NullOr(Schema.Struct({ ...ArtifactsHome.fields, why: Schema.String })),
})
export type ArtifactsPlace = typeof ArtifactsPlace.Type

/** A repository's folders at the head of its default branch, each with a trailing slash, in path order. */
export const RepositoryFolders = Schema.Struct({ folders: Schema.Array(Schema.String), truncated: Schema.Boolean })
export type RepositoryFolders = typeof RepositoryFolders.Type

/*
 * Downloading a canvas, as a file to send or keep: its own source (the
 * Markdown, the diagram's words, the drawing, the picture), its files in a
 * folder, or as drawn: a PNG (one a board, for a canvas of boards), a PDF (a
 * page a board), or a diagram's SVG.
 */

export const CanvasDownloadFormat = Schema.Literals(['source', 'files', 'png', 'pdf', 'svg'])
export type CanvasDownloadFormat = typeof CanvasDownloadFormat.Type

/** What each kind downloads as, the first the one most wanted. */
export const CANVAS_DOWNLOADS: Readonly<Record<CanvasKind, ReadonlyArray<CanvasDownloadFormat>>> = {
  markdown: ['source'],
  mermaid: ['svg', 'png', 'source'],
  svg: ['source', 'png'],
  picture: ['source'],
  html: ['png', 'pdf', 'files'],
  boards: ['png', 'pdf', 'files'],
}

/** A version to download, and how: what the window asks the main process for. A diagram's SVG is the one the window drew. */
export interface CanvasDownload {
  readonly projectId: string
  readonly canvasId: string
  readonly version: number
  readonly manifest: string
  /** The canvas's name, which the files are named by. */
  readonly name: string
  readonly kind: CanvasKind
  readonly format: CanvasDownloadFormat
  readonly svg?: string
}

/** How a download went: where it was saved, or that the person called it off, or what went wrong in words. */
export type CanvasDownloaded =
  | { readonly kind: 'saved'; readonly path: string }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly why: string }

/** A canvas saved to a repository: where, how, and how its last save went. */
export const CanvasSaved = Schema.Struct({
  repositoryId: Schema.String,
  repository: Schema.String,
  /** The canvas's own folder in the repository, with a trailing slash: `design/gift-a-class/`. */
  path: Schema.String,
  how: ArtifactsHow,
  follow: Schema.Boolean,
  /** The version last committed, and its commit; null until the first save is done. */
  version: Schema.NullOr(Schema.Number),
  commit: Schema.NullOr(Schema.String),
  /** The pull request it went in, where it goes in one. */
  pullRequest: Schema.NullOr(Schema.Struct({ number: Schema.Number, url: Schema.String })),
  /** Saving while a commit is under way; failed with what went wrong, in words for the person. */
  state: Schema.Literals(['saving', 'saved', 'failed']),
  problem: Schema.NullOr(Schema.String),
})
export type CanvasSaved = typeof CanvasSaved.Type

/** A canvas in its project's list: its latest version and what is open on it. */
/**
 * An artifact's own conversation (ADR-104, "Talking to an artifact"): a chat whose part is the artifact, where anyone who opens
 * it talks about it or has it changed. It is never a task on the board nor an aside: no lanes, no states, nothing waiting on the
 * person. Its agent changes the artifact as any lead does, by publishing a new version; the lead that drew it still can too.
 */
export const ArtifactChat = Schema.Struct({ taskId: Schema.String, threadId: Schema.String })
export type ArtifactChat = typeof ArtifactChat.Type

/**
 * An artifact whose own chat is drawing its first version: started by the coordinator (`start_artifact`) or from the Artifacts
 * view, it shows among the project's artifacts from the moment it starts, before it has a canvas.
 */
export const ArtifactDrawing = Schema.Struct({
  taskId: Schema.String,
  threadId: Schema.String,
  projectId: Schema.String,
  /** What it is, as whoever started it named it. */
  title: Schema.String,
  startedAt: Schema.String,
})
export type ArtifactDrawing = typeof ArtifactDrawing.Type

export const CanvasSummary = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  group: Schema.NullOr(Schema.String),
  latest: CanvasVersionFacts,
  versions: Schema.Number,
  openComments: Schema.Number,
  archived: Schema.Boolean,
  /** Where it is saved in git; null or absent where it lives in Althar only. */
  saved: Schema.optional(Schema.NullOr(CanvasSaved)),
  /** Its own conversation, once someone has talked to it; null or absent before. */
  chat: Schema.optional(Schema.NullOr(ArtifactChat)),
})
export type CanvasSummary = typeof CanvasSummary.Type

/** A comment the person sent on a canvas: who, on which version, where, and whether an agent answered it. */
export const CanvasCommentFacts = Schema.Struct({
  id: Schema.String,
  version: Schema.Number,
  anchor: CanvasAnchor,
  body: Schema.String,
  at: Schema.String,
  /** Answered: by which version, with the agent's line; null while it is open. */
  resolved: Schema.NullOr(
    Schema.Struct({ byVersion: Schema.NullOr(Schema.Number), note: Schema.NullOr(Schema.String), at: Schema.String }),
  ),
})
export type CanvasCommentFacts = typeof CanvasCommentFacts.Type

/** A canvas whole: its versions, newest last, and the comments sent on it. */
export const CanvasDetail = Schema.Struct({
  summary: CanvasSummary,
  versions: Schema.Array(CanvasVersionFacts),
  comments: Schema.Array(CanvasCommentFacts),
})
export type CanvasDetail = typeof CanvasDetail.Type

/** A version's entry as the window draws it: its words, for a document, a diagram or an SVG. */
export const CanvasText = Schema.Struct({ path: Schema.String, text: Schema.String, bytes: Schema.Number })
export type CanvasText = typeof CanvasText.Type
