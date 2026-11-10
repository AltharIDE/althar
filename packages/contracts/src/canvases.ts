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

/** How a canvas is drawn, told by its entry's extension. */
export const CanvasKind = Schema.Literals(['markdown', 'mermaid', 'svg', 'picture', 'html'])
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

/** Where an agent's working copies are, in the folder it starts from. */
export const CANVASES_FOLDER = '.althar/canvases'

/** A path inside a canvas that is Althar's own, which a publish refuses. */
export const isReservedCanvasPath = (path: string) => path === '.althar' || path.startsWith('.althar/')

const EXTENSION = /\.([a-z0-9]+)$/

const extensionOf = (path: string) => EXTENSION.exec(path.toLowerCase())?.[1] ?? ''

/** How a canvas whose entry is at `path` is drawn; null for an entry Althar can't draw. */
export const canvasKindOf = (path: string): CanvasKind | null => {
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
  role: Schema.Literals(['lead', 'coordinator']),
  taskId: Schema.NullOr(Schema.String),
  /** The task's title, as it is now; null for the coordinator. */
  taskTitle: Schema.NullOr(Schema.String),
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

/** A canvas in its project's list: its latest version and what is open on it. */
export const CanvasSummary = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  group: Schema.NullOr(Schema.String),
  latest: CanvasVersionFacts,
  versions: Schema.Number,
  openComments: Schema.Number,
  archived: Schema.Boolean,
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
