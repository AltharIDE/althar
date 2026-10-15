import { join } from 'node:path'

/*
 * Where the artifact store keeps a digest's bytes, and what its pictures
 * are: shared with the app's main process, which serves pictures to the
 * window from the store without the database (`@althar/runtime/artifacts`).
 */

export { pictureSize, pictureType, type PictureType, type Size } from './pictures'

/** The file a digest is kept in: two levels, so no folder holds too many. */
export const artifactPath = (root: string, sha256: string) => join(root, sha256.slice(0, 2), sha256)

/** A digest as the store names files: 64 hex digits, and nothing else. */
export const isDigest = (value: string) => /^[0-9a-f]{64}$/.test(value)
