import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import { Schema } from 'effect'

import { privateDirectory, readPrivate, removePrivate, writePrivate } from '../privateFiles'
import { Identifier, updateError, type Installation, type Transaction } from './store'

const Reservation = Schema.Struct({ format: Schema.Literal(1), token: Identifier, owner: Schema.String })
const pathOf = (installation: Pick<Installation, 'config'>) => join(installation.config.profile, 'althar.sqlite.maintenance')
const reserved = () =>
  updateError(
    'UpdateRecoveryRequired',
    'The database update reservation is missing, invalid or belongs to another installation. Its contents will not be restored or opened automatically.',
  )
const read = async (installation: Pick<Installation, 'config'>) => {
  try {
    const bytes = await readPrivate(pathOf(installation), 4096)
    return bytes === null
      ? undefined
      : Schema.decodeUnknownSync(Reservation)(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
  } catch {
    throw reserved()
  }
}
export const reserveDatabase = async (installation: Installation, transaction: Transaction) => {
  await privateDirectory(installation.config.profile)
  const database = await fs.lstat(join(installation.config.profile, 'althar.sqlite'))
  if (!database.isFile() || database.isSymbolicLink() || database.nlink !== 1)
    throw updateError('UpdateFailed', 'Managed updates require the profile database to be a regular file without symbolic or hard links.')
  const before = await read(installation)
  if (before !== undefined && before.owner !== installation.root) throw reserved()
  await writePrivate(pathOf(installation), JSON.stringify({ format: 1, token: transaction.id, owner: installation.root }), true)
}
export const assertReservation = async (installation: Installation, transaction: Transaction) => {
  const value = await read(installation)
  if (value === undefined || value.owner !== installation.root || value.token !== transaction.id) throw reserved()
}
/** Hand a permit to storage only after verifying the managed executable and journal phase. */
export const databasePermit = async (installation: Installation): Promise<string | undefined> => {
  const value = await read(installation)
  if (value === undefined) {
    if (installation.state.transaction !== undefined) throw reserved()
    return undefined
  }
  if (
    value.owner !== installation.root ||
    (installation.state.transaction !== undefined && value.token !== installation.state.transaction.id)
  )
    throw reserved()
  return value.token
}
export const releaseReservation = async (installation: Installation, token?: string) => {
  const value = await read(installation)
  if (value === undefined) return
  if (value.owner !== installation.root || (token !== undefined && token !== value.token)) throw reserved()
  await removePrivate(pathOf(installation), 4096)
}
