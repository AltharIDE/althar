import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { fleetUpdate, type UpdateKind, type UpdateRow, Updates } from '@althar/ui'

import { LAST_WITHOUT_HOME_SETTINGS, newer } from '../../../homes'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { useUpdate } from '../../shared/useUpdate'
import { updating, updatingWorkersOf, useNewestWorkerRelease, usePressed, useWorkerUpdates } from '../../shared/workerUpdates'
import { useHomeName, useHomeUpdating } from '../homes/useHomes'
import { hideUpdate, useHiddenUpdates } from './hidden'
import { appRow, homeRow, whereStill, workersRow } from './rows'

/*
 * Every update in the window's bar, left of CPU and MEM, under one glyph
 * (the kit's Updates), in place of Althar's own line: Althar's update on this
 * computer; the window's home's, where that's another computer and a newer
 * release is out; and the home's workers', against the newest worker
 * release. The workers are read once a minute, and every few seconds while
 * an update of theirs is asked for or under way. Each row is put aside until
 * its next release; with none left, the bar says for a moment where they
 * still are, a way there.
 */

/** The workers are read this often for their updates, and this often while one is under way. */
const QUIET = 60_000
const WATCHING = 3_000
/** How long the bar says where updates put aside still are. */
const STILL = 4_000

export function BarUpdates() {
  const { client, host } = useServices()
  const navigate = useNavigate()
  const app = useUpdate()

  // The window's home, where it's another computer: its release against the newest.
  const { remote, name } = useHomeName()
  const homes = host.homes
  const homeVersion = useQuery({ ...reads(client).status(), enabled: remote }).data?.appVersion
  const homeNews = useQuery({
    queryKey: ['homes', 'hostRelease', 0],
    queryFn: () => homes?.release?.(false) ?? Promise.resolve(null),
    enabled: remote && homes?.release !== undefined,
    staleTime: 5 * 60_000,
    retry: false,
  }).data
  const homeNewest = homeNews?.newest ?? null
  const homeBehind = remote && homeVersion !== undefined && homeNewest !== null && newer(homeNewest, homeVersion)
  const home = useHomeUpdating(homeBehind, undefined, homeVersion ?? LAST_WITHOUT_HOME_SETTINGS)
  const [asking, setAsking] = useState(false)

  // The home's workers, against the newest worker release.
  const workersRead = useQuery({
    queryKey: keys.workers,
    queryFn: () => client.getWorkers(),
    refetchInterval: (query) => (updating(query.state.data) ? WATCHING : QUIET),
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  })
  const workers = workersRead.data ?? null
  const newest = useNewestWorkerRelease((workers?.workers ?? []).some((one) => one.release !== undefined))
  const pressed = usePressed()
  const updates = useWorkerUpdates()
  const list = updatingWorkersOf(workers, newest, pressed)
  const counted = list.filter((one) => one.update !== undefined).length

  const hidden = useHiddenUpdates()
  const [still, setStill] = useState<UpdateKind | null>(null)
  useEffect(() => {
    if (still === null) return
    const gone = setTimeout(() => setStill(null), STILL)
    return () => clearTimeout(gone)
  }, [still])

  const versions: Record<UpdateKind, string> = {
    app: app.ready?.version ?? '',
    home: homeNewest ?? '',
    workers: newest ?? '',
  }
  const rows = [
    appRow(app.ready),
    remote
      ? homeRow({
          name,
          newest: homeBehind ? homeNewest : null,
          offer: home.offer,
          onUpdate: home.onUpdate,
          onCancelUpdate: home.onCancelUpdate,
          asking,
          onAsk: setAsking,
        })
      : null,
    workersRow(fleetUpdate(list), counted, updates.update, updates.cancel),
  ].filter((row): row is UpdateRow => row !== null && !(row.hides && hidden[row.kind] === versions[row.kind]))

  const place = still === null ? null : whereStill[still]
  return (
    <Updates
      rows={rows}
      onHide={(kind) => {
        hideUpdate(kind, versions[kind])
        if (rows.every((row) => row.kind === kind)) setStill(kind)
      }}
      still={
        place === null
          ? null
          : { where: place.where, onShow: () => void navigate({ to: '/settings/$section', params: { section: place.section } }) }
      }
      {...(app.check === undefined ? {} : { onCheck: app.check, checking: app.checking })}
    />
  )
}
