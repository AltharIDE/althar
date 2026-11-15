import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { resolve } from 'node:path'

import { Effect, Schema } from 'effect'

/** A host update reserves the stopped profile across processes and migration/recovery phases. */
export class DatabaseInMaintenance extends Schema.TaggedError<DatabaseInMaintenance>()('DatabaseInMaintenance', {
  filename: Schema.String,
}) {}

/** No environment variable grants this permit. Only the trusted host passes it as an explicit database option. */
export const checkMaintenance = (filename: string, permit?: string) =>
  Effect.tryPromise({
    try: async () => {
      if (filename === ':memory:') return
      let handle: fs.FileHandle | undefined
      try {
        const database = await fs.realpath(filename).catch((error: unknown) => {
          if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return resolve(filename)
          throw error
        })
        handle = await fs.open(`${database}.maintenance`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
        const stat = await handle.stat()
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.size > 4096 ||
          (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) ||
          (process.getuid !== undefined && stat.uid !== process.getuid())
        )
          throw new Error('Unsafe reservation')
        const bytes = Buffer.alloc(4097)
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
        if (bytesRead > 4096) throw new Error('Oversized reservation')
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead)))
        if (
          typeof value !== 'object' ||
          value === null ||
          !('format' in value) ||
          value.format !== 1 ||
          !('token' in value) ||
          typeof value.token !== 'string' ||
          !/^[a-f0-9]{32}$/.test(value.token) ||
          value.token !== permit
        )
          throw new Error('Reserved')
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return
        throw error
      } finally {
        await handle?.close().catch(() => undefined)
      }
    },
    catch: () => new DatabaseInMaintenance({ filename }),
  })
