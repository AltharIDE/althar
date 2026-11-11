import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { canvasAddressOf, CanvasManifest } from '@althar/contracts'
import { artifactPath, isDigest } from '@althar/runtime/artifacts'
import { Schema } from 'effect'

/*
 * An HTML canvas's files (ADR-104), served at its address: the canvas is the
 * origin (`althar-canvas://<id>/`), a version the path under it (`/v3/`), so
 * an address always gives the same bytes. Only versions Althar's own window
 * opened are served, from the manifest it named by digest, which is read
 * from the artifact store and checked against its digest; anything not in
 * that manifest is a 404. Every answer carries headers Althar writes: the
 * type the manifest gives it, `nosniff`, and a policy that keeps plugins out
 * and the page from being framed by anything but itself. What it may load
 * from elsewhere is the project's network's (views.ts).
 */

/** The manifest digest Althar's window opened a version at, by its canvas's host and number; null for one it didn't. */
export type Opened = (host: string, version: number) => string | null

/** What every answer says of itself, apart from its type. */
export const CANVAS_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "object-src 'none'; frame-ancestors 'self'; base-uri 'self'",
  'x-content-type-options': 'nosniff',
  // A version never changes.
  'cache-control': 'private, max-age=31536000, immutable',
  'cross-origin-resource-policy': 'same-origin',
}

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(CanvasManifest))

const missing = () => new Response(null, { status: 404 })

/** The manifests read so far, by digest: a digest's bytes never change. */
const manifests = new Map<string, CanvasManifest>()

const manifestAt = async (root: string, digest: string): Promise<CanvasManifest | null> => {
  const known = manifests.get(digest)
  if (known !== undefined) return known
  const bytes = await readFile(artifactPath(root, digest)).catch(() => null)
  if (bytes === null || createHash('sha256').update(bytes).digest('hex') !== digest) return null
  try {
    const manifest = decode(bytes.toString('utf8'))
    manifests.set(digest, manifest)
    return manifest
  } catch {
    return null
  }
}

/** The file an address's path names in a manifest: the entry for the version's root, a folder's index, else the path itself. */
export const fileIn = (manifest: CanvasManifest, path: string) => {
  const files = manifest.files
  if (path === '') return files.find((file) => file.path === manifest.entry) ?? null
  const exact = files.find((file) => file.path === path)
  if (exact !== undefined) return exact
  const folder = path.endsWith('/') ? path : `${path}/`
  return files.find((file) => file.path === `${folder}index.html`) ?? null
}

/**
 * Answers a canvas address from the store at `root`: the file of the
 * version the window opened, or Althar's tokens at `/.althar/tokens.css`,
 * or 404 for anything else.
 */
export const serveCanvas =
  (root: string, opened: Opened, tokens: () => string) =>
  async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
    const asked = canvasAddressOf(request.url)
    if (asked === null) return missing()
    const digest = opened(asked.host, asked.version)
    if (digest === null || !isDigest(digest)) return missing()
    if (asked.path === '.althar/tokens.css')
      return new Response(tokens(), { headers: { ...CANVAS_HEADERS, 'content-type': 'text/css; charset=utf-8' } })
    const manifest = await manifestAt(root, digest)
    if (manifest === null) return missing()
    const file = fileIn(manifest, asked.path)
    if (file === null || !isDigest(file.sha256)) return missing()
    const bytes = await readFile(artifactPath(root, file.sha256)).catch(() => null)
    if (bytes === null) return missing()
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), {
      headers: { ...CANVAS_HEADERS, 'content-type': file.type, 'content-length': String(bytes.length) },
    })
  }

/** Forgets the manifests read: for tests. */
export const forgetManifests = () => manifests.clear()
