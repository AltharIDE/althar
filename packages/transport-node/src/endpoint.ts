import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { API_VERSION, HomeId } from '@althar/contracts'
import { Effect, Schema } from 'effect'

import { TransportError, transportError } from './errors'

export const LocalApiEndpoint = Schema.Struct({
  protocol: Schema.Literal(1),
  homeId: HomeId,
  apiVersion: Schema.Int,
  address: Schema.String,
  secret: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  /** Direct pairing settings active on this socket's host process, where configured. */
  networkFingerprint: Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))),
})
export type LocalApiEndpoint = typeof LocalApiEndpoint.Type
const unsafe = () =>
  transportError('UnsafeEndpoint', 'The private API descriptor is missing or unsafe. Check the profile and host service.')
export const readLocalEndpoint = (profile: string, expectedHome?: string) =>
  Effect.tryPromise({
    try: async () => {
      if (!isAbsolute(profile) || profile.includes('\0')) throw unsafe()
      for (const [directory, mask] of [
        [profile, 0o022],
        [join(profile, 'api'), 0o077],
      ] as const) {
        const stat = await fs.lstat(directory)
        if (
          !stat.isDirectory() ||
          stat.isSymbolicLink() ||
          (process.platform !== 'win32' && (stat.mode & mask) !== 0) ||
          (process.getuid !== undefined && stat.uid !== process.getuid())
        )
          throw unsafe()
      }
      const handle = await fs.open(join(profile, 'api/endpoint.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      let bytes: Buffer
      try {
        const stat = await handle.stat()
        if (
          !stat.isFile() ||
          stat.nlink !== 1 ||
          stat.size > 16_384 ||
          (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) ||
          (process.getuid !== undefined && stat.uid !== process.getuid())
        )
          throw unsafe()
        const buffer = Buffer.alloc(16_385)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        if (bytesRead > 16_384) throw unsafe()
        bytes = buffer.subarray(0, bytesRead)
      } finally {
        await handle.close()
      }
      const endpoint = Schema.decodeUnknownSync(LocalApiEndpoint)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
      if (!isAbsolute(endpoint.address) || endpoint.address.includes('\0')) throw unsafe()
      if (endpoint.apiVersion !== API_VERSION)
        throw transportError('ApiVersionMismatch', 'This host and client speak different API versions. Update them before reconnecting.')
      if (expectedHome !== undefined && endpoint.homeId !== expectedHome)
        throw transportError('HomeMismatch', 'This profile belongs to a different Althar home. Check its identity before reconnecting.')
      return endpoint
    },
    catch: (error) => (error instanceof TransportError ? error : unsafe()),
  })
