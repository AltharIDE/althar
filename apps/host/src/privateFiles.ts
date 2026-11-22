import * as privateFiles from '@althar/runtime/privateFiles'
import { HostError } from './errors'

const hostFile = async <A>(operation: Promise<A>): Promise<A> => {
  try {
    return await operation
  } catch (error) {
    if (!(error instanceof privateFiles.PrivateFileError)) throw error
    throw new HostError({
      code: error.code,
      message: error.code === 'NotInitialized' ? 'This host has not been initialized. Run althar-host init first.' : error.message,
    })
  }
}

export const privateDirectory = (path: string, create = false) => hostFile(privateFiles.privateDirectory(path, create))
export const readPrivate = (path: string, maximum: number, links: boolean | 'snapshot' = false) =>
  hostFile(privateFiles.readPrivate(path, maximum, links))
export const writePrivate = (path: string, value: Uint8Array | string, replace: boolean) =>
  hostFile(privateFiles.writePrivate(path, value, replace))
export const removePrivate = (path: string, maximum: number) => hostFile(privateFiles.removePrivate(path, maximum))
