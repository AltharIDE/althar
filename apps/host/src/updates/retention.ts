import * as fs from 'node:fs/promises'
import { join } from 'node:path'

import { loadInstallation, readReceipt } from './store'

const hash = /^[a-f0-9]{64}$/
const identifier = /^[a-f0-9]{32}$/
const newest = async (folder: string, names: ReadonlyArray<string>) => {
  const entries = await Promise.all(names.map(async (name) => ({ name, at: (await fs.lstat(join(folder, name))).mtimeMs })))
  return entries.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name)).map(({ name }) => name)
}

/** Called only by the locked controller. Recovery references always win over age or count. */
export const pruneInstallation = async (root: string) => {
  const { config, state } = await loadInstallation(root)
  // A power loss can bypass staging's finally block. No other downloader can
  // own these directories while this controller holds the installation lock.
  for (const name of await fs.readdir(root)) {
    if (/^\.staging-[a-f0-9]{32}$/.test(name)) await fs.rm(join(root, name), { recursive: true, force: true })
  }
  const retained = new Set([config.bootstrap, state.current, state.active, state.staged, state.failed, state.seen])
  if (state.transaction !== undefined) {
    retained.add(state.transaction.from)
    retained.add(state.transaction.to)
  }
  const requests = new Set(
    (await fs.readdir(join(root, 'requests'))).filter((name) => identifier.test(name.slice(0, -5)) && name.endsWith('.json')),
  )
  for (const name of requests) {
    const receipt = await readReceipt(root, name.slice(0, -5))
    if (receipt.release !== undefined) retained.add(receipt.release)
  }
  const releases = join(root, 'releases')
  const unreferenced = (await fs.readdir(releases)).filter((name) => hash.test(name) && !retained.has(name))
  for (const name of (await newest(releases, unreferenced)).slice(3)) {
    await fs.rm(join(releases, name), { recursive: true, force: true })
    await fs.rm(join(root, 'records', `${name}.json`), { force: true })
  }
  const snapshots = join(root, 'snapshots')
  const copies = (await fs.readdir(snapshots)).filter(
    (name) => name.endsWith('.sqlite') && identifier.test(name.slice(0, -7)) && name !== `${state.transaction?.id}.sqlite`,
  )
  for (const name of (await newest(snapshots, copies)).slice(3)) await fs.rm(join(snapshots, name), { force: true })
  const receipts = join(root, 'receipts')
  const completed = (await fs.readdir(receipts)).filter(
    (name) =>
      name.endsWith('.json') && identifier.test(name.slice(0, -5)) && !requests.has(name) && name !== `${state.transaction?.id}.json`,
  )
  for (const name of (await newest(receipts, completed)).slice(100)) await fs.rm(join(receipts, name), { force: true })
}
