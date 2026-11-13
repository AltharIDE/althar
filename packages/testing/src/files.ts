import { realpathSync, rmSync } from 'node:fs'
import { rm } from 'node:fs/promises'

/** Compare paths in output which deliberately uses forward slashes on every platform. */
export const slashPath = (path: string): string => path.replaceAll('\\', '/')

/** A filesystem path as git sees it too: expand Windows' short temporary names and macOS' /var link. */
export const realPath = (path: string): string => realpathSync(path)

// Windows may still hold a folder after a child exits, or while a scanner reads it. Node retries only the
// retryable filesystem errors, with linear backoff; a persistent failure still fails the test.
const removal = { recursive: true, force: true, maxRetries: 20, retryDelay: 100 } as const

export const removeTree = (path: string): Promise<void> => rm(path, removal)
export const removeTreeSync = (path: string): void => rmSync(path, removal)
