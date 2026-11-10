import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

import {
  CANVAS_LIMITS,
  CANVASES_FOLDER,
  type CanvasFile,
  canvasMediaTypeOf,
  type CanvasManifest,
  isReservedCanvasPath,
} from '@althar/contracts'
import { cleanUp, removeFully } from '@althar/provider-adapters'
import { Effect } from 'effect'

/*
 * A canvas's working copies on disk (ADR-104): the files an agent edits with
 * its own tools, in `.althar/canvases/<name>/` in the folder it starts from,
 * which git ignores. Read whole to publish, without following a link or
 * leaving the copy; compared with what was put there, to tell an edit; and
 * written, a version's files, into a folder of their own, never over a copy
 * with edits in it. Pure Node, so each rule is tested on its own.
 */

/** A file of a copy, as read to publish: its path in the canvas, with `/`, and its bytes. */
export interface CopyFile {
  readonly path: string
  readonly bytes: Uint8Array
}

/** What reading a copy found: its files, or why it can't be published, in words for the agent. */
export type ReadCopy = { readonly ok: true; readonly files: ReadonlyArray<CopyFile> } | { readonly ok: false; readonly why: string }

/** The folder an agent's working copies are in, made where it isn't, with the `.gitignore` that keeps them out of git. */
export const canvasesIn = (root: string) => {
  const folder = join(root, ...CANVASES_FOLDER.split('/'))
  mkdirSync(folder, { recursive: true })
  const ignore = join(folder, '.gitignore')
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n')
  return folder
}

const MB = 1024 * 1024

/** Reads every file of a copy, in path order: links aren't followed, Althar's own paths are refused, and the limits hold. */
export const readCopy = (folder: string): ReadCopy => {
  const top = lstatSync(folder, { throwIfNoEntry: false })
  if (top === undefined) return { ok: false, why: 'There is nothing there yet.' }
  if (top.isSymbolicLink() || !top.isDirectory())
    return { ok: false, why: 'It is not a folder of its own: a link or a file is in its place.' }
  const files: Array<CopyFile> = []
  let bytes = 0
  const folders = [folder]
  while (folders.length > 0) {
    const at = folders.pop() ?? folder
    for (const name of readdirSync(at).toSorted()) {
      const inside = join(at, name)
      const path = relative(folder, inside).split(sep).join('/')
      const found = lstatSync(inside, { throwIfNoEntry: false })
      // A link could lead out of the copy: it isn't followed, and the agent hears so.
      if (found === undefined) continue
      if (found.isSymbolicLink())
        return { ok: false, why: `${path} is a link. A canvas holds its own files; copy what it links to instead.` }
      if (isReservedCanvasPath(path)) return { ok: false, why: `${path} is Althar's own: nothing in a canvas can be under .althar/.` }
      if (found.isDirectory()) folders.push(inside)
      else if (found.isFile()) {
        if (found.size > CANVAS_LIMITS.file)
          return { ok: false, why: `${path} is ${Math.ceil(found.size / MB)} MB; a file can be at most ${CANVAS_LIMITS.file / MB} MB.` }
        bytes += found.size
        if (bytes > CANVAS_LIMITS.bytes)
          return { ok: false, why: `It holds more than ${CANVAS_LIMITS.bytes / MB} MB; a version can be at most that.` }
        if (files.length + 1 > CANVAS_LIMITS.files)
          return {
            ok: false,
            why: `It holds more than ${CANVAS_LIMITS.files.toLocaleString('en')} files; a version can hold at most that many.`,
          }
        files.push({ path, bytes: new Uint8Array(readFileSync(inside)) })
      }
    }
  }
  if (files.length === 0) return { ok: false, why: 'It has no files in it.' }
  return { ok: true, files: files.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) }
}

/** A file's digest, as the artifact store names it. */
export const digestOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** The manifest of a copy's files, with the entry drawn first. */
export const manifestOf = (entry: string, files: ReadonlyArray<CopyFile>): CanvasManifest => ({
  entry,
  files: files.map((file): CanvasFile => ({
    path: file.path,
    sha256: digestOf(file.bytes),
    size: file.bytes.length,
    type: canvasMediaTypeOf(file.path),
  })),
})

/** Whether a copy holds exactly a manifest's files, unchanged: nothing added, taken away or edited since it was put there. */
export const holdsOnly = (folder: string, manifest: CanvasManifest) => {
  const read = readCopy(folder)
  if (!read.ok || read.files.length !== manifest.files.length) return false
  const wanted = new Map(manifest.files.map((file) => [file.path, file.sha256]))
  return read.files.every((file) => wanted.get(file.path) === digestOf(file.bytes))
}

/**
 * Writes a version's files as a copy at `folder`, replacing what is there:
 * written aside first, then put in its place, so a copy is never half one
 * version and half another. Only for a folder that isn't there, or holds
 * nothing but a version put there before.
 */
export const writeCopy = (folder: string, files: ReadonlyArray<CopyFile>) => {
  const aside = `${folder}.${randomUUID()}.incoming`
  return Effect.gen(function* () {
    yield* Effect.promise(async () => {
      for (const file of files) {
        const target = join(aside, ...file.path.split('/'))
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, file.bytes)
      }
      await mkdir(aside, { recursive: true })
    })
    yield* Effect.orDie(removeFully(folder))
    yield* Effect.promise(() => rename(aside, folder))
  }).pipe(Effect.ensuring(cleanUp(aside, "a canvas's copy written aside")))
}

/**
 * Where a version set aside goes beside an edited copy: `<name>@<n>`, or the
 * next free `<name>@<n>-2`, `-3`, where that is taken by something that
 * isn't the version as it was put there (`isVersion`).
 */
export const asideFor = (
  root: string,
  name: string,
  version: number,
  isVersion: (path: string) => boolean,
): { readonly path: string; readonly reuse: boolean } => {
  for (let n = 1; ; n += 1) {
    const path = n === 1 ? `${name}@${version}` : `${name}@${version}-${n}`
    if (!existsSync(join(root, path))) return { path, reuse: false }
    if (isVersion(path)) return { path, reuse: true }
  }
}

/** A copy's path, as an agent names it with `from`: a canvas's name, or one set aside (`login-flow@4`, `login-flow@4-2`). */
export const isCopyPath = (path: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*(?:@[1-9][0-9]{0,8}(?:-[2-9]|-[1-9][0-9]+)?)?$/.test(path)
