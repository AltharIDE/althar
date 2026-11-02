import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readdirSync, readSync } from 'node:fs'
import { join, relative } from 'node:path'

/*
 * Which processors a Mac app's programs are built for. Each Mac build is for
 * one processor, Apple silicon (arm64) or Intel (x64), and bundles that one's
 * Electron, Node, agents and speech engine: an Intel Mac can't run an arm64
 * program at all, and Rosetta would run an x64 one on Apple silicon without
 * saying so, slower. So package.ts reads every Mach-O file in the packaged
 * app with lipo and fails the build where one isn't for the build's processor.
 */

/** lipo's name for each processor, by Node's `process.arch`. */
export const LIPO_ARCH: Readonly<Record<string, string>> = { arm64: 'arm64', x64: 'x86_64' }

/**
 * What a Mac build is made as, for a processor: the folder electron-builder
 * puts the app in (`mac-arm64`, or `mac` for x64, its default) and the
 * packages, named with the processor either way, so the updater and the
 * site can tell them apart and each has a name to link to.
 */
export const macBuild = (productName: string, version: string, arch: string) => ({
  folder: arch === 'x64' ? 'mac' : `mac-${arch}`,
  dmg: `${productName}-${version}-${arch}.dmg`,
  zip: `${productName}-${version}-${arch}-mac.zip`,
})

/** Whether a file's first eight bytes are a Mach-O's: a thin one either way round, or a fat one, told from a Java class (also 0xcafebabe) by its count of slices. */
export const isMachO = (head: Uint8Array): boolean => {
  if (head.length < 8) return false
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const magic = view.getUint32(0, false)
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe].includes(magic)) return true
  // A fat file's slice count; a class file has its version there, 45 or more.
  return (magic === 0xcafebabe || magic === 0xcafebabf) && view.getUint32(4, false) < 45
}

const headOf = (path: string) => {
  const head = new Uint8Array(8)
  const fd = openSync(path, 'r')
  try {
    return head.subarray(0, readSync(fd, head, 0, 8, 0))
  } finally {
    closeSync(fd)
  }
}

/** Every Mach-O file under `folder`, symbolic links left out (a framework's Versions/Current is one). */
export const machOFiles = (folder: string): ReadonlyArray<string> =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => isMachO(headOf(path)))

/** The processors a Mach-O file holds, as lipo names them. */
export const archsOf = (path: string): ReadonlyArray<string> =>
  execFileSync('lipo', ['-archs', path], { encoding: 'utf8' }).trim().split(/\s+/)

/** Each Mach-O file in `app` without a slice for `arch`, with what it holds instead; and how many were read. */
export const wrongArchs = (app: string, arch: string) => {
  const wanted = LIPO_ARCH[arch]
  if (wanted === undefined) throw new Error(`No Mac build is made for ${arch}.`)
  const files = machOFiles(app)
  const wrong = files.map((path) => ({ path: relative(app, path), archs: archsOf(path) })).filter(({ archs }) => !archs.includes(wanted))
  return { read: files.length, wrong }
}
