import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { dirname, isAbsolute, normalize } from 'node:path'

import { HomeId } from '@althar/contracts'
import { ApprovalCredentials } from '@althar/runtime'
import { Schema } from 'effect'

import { HostError } from './errors'

const MaximumBytes = 384 * 1024
const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  homeId: HomeId,
  origin: Schema.String,
  credentials: ApprovalCredentials,
})

const invalid = () =>
  new HostError({
    code: 'InvalidConfig',
    message: 'Use an approval-key file installed by the server administrator for this home and HTTPS address.',
  })

/** A same-user agent must not add its own approval key. Every path component belongs to the server administrator. */
export const readApprovalKeys = async (path: string, origin: string) => {
  try {
    if (!isAbsolute(path) || path !== normalize(path)) throw invalid()
    let directory = dirname(path)
    for (;;) {
      const stat = await lstat(directory)
      if (!stat.isDirectory() || stat.uid !== 0 || (stat.mode & 0o022) !== 0) throw invalid()
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o022) !== 0 || stat.size > MaximumBytes) throw invalid()
      const bytes = await file.readFile()
      if (bytes.length > MaximumBytes) throw invalid()
      const manifest = Schema.decodeUnknownSync(Manifest)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
      if (manifest.origin !== origin) throw invalid()
      return manifest
    } finally {
      await file.close()
    }
  } catch {
    throw invalid()
  }
}
