import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import type { AcpCatalog, AcpSavedConnection } from '@althar/contracts'
import { AgentCatalog, type AcpConnectionDraft } from '@althar/ui'

import { messageOf } from '../../data/client'
import { keys } from '../../data/reads'
import { useServices } from '../../data/services'
import type { StartModel } from '../start/useStart'

const key = keys.agentCatalog
type Pending = { readonly value: AcpSavedConnection | null; readonly revision: number | null; readonly token: symbol }

/** Changes stay visible until a read at their acknowledged revision arrives. Older reads cannot undo a press. */
export function AgentCatalogSection({ start, active = true }: { start: StartModel; active?: boolean }) {
  const { client, cache } = useServices()
  const newest = useRef<AcpCatalog | undefined>(undefined)
  const [pending, setPending] = useState<Readonly<Record<string, Pending>>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const take = (next: AcpCatalog) => {
    if (newest.current !== undefined && newest.current.revision > next.revision) return newest.current
    newest.current = next
    return next
  }
  const read = useQuery({
    queryKey: key,
    queryFn: async () => take(await client.agentCatalog()),
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      query.state.data?.refreshing === true ||
      query.state.data?.connections.some((one) => one.state === 'checking') === true ||
      Object.keys(pending).length > 0
        ? 1000
        : false,
  })
  const data = read.data
  const ready = data?.connections
    .filter((one) => one.state === 'ready')
    .map((one) => `${one.connection.id}:${one.version}`)
    .join(',')
  const recheck = start.recheck
  useEffect(() => {
    if (ready !== undefined) void recheck()
  }, [ready, recheck])
  useEffect(() => {
    if (data === undefined) return
    setPending((now) => {
      const left = Object.entries(now).filter(([, change]) => change.revision === null || data.revision < change.revision)
      return left.length === Object.keys(now).length ? now : Object.fromEntries(left)
    })
  }, [data])
  const connections = new Map((data?.connections ?? []).map((one) => [one.connection.id, one]))
  for (const [id, change] of Object.entries(pending)) {
    if (change.revision !== null && data !== undefined && data.revision >= change.revision) continue
    if (change.value === null) connections.delete(id)
    else connections.set(id, change.value)
  }
  const change = (id: string, value: AcpSavedConnection | null, action: () => Promise<number>, done?: () => void) => {
    const token = Symbol()
    setError(null)
    setPending((now) => ({ ...now, [id]: { value, revision: null, token } }))
    void action()
      .then(
        (revision) => {
          setPending((now) => (now[id]?.token === token ? { ...now, [id]: { value, revision, token } } : now))
          done?.()
          void cache.invalidateQueries({ queryKey: key })
        },
        (failure: unknown) => {
          setError(messageOf(failure))
          setPending((now) => Object.fromEntries(Object.entries(now).filter(([one, entry]) => one !== id || entry.token !== token)))
        },
      )
      .finally(() => setSaving(false))
  }
  const save = (connection: AcpConnectionDraft, done?: () => void) => {
    setSaving(true)
    change(connection.id, { connection, state: 'unchecked', version: null, reason: null }, () => client.saveAcpConnection(connection), done)
  }
  return (
    <AgentCatalog
      active={active}
      items={data?.items ?? []}
      connections={[...connections.values()]}
      saving={saving}
      refreshing={refreshing || data?.refreshing === true}
      problem={data?.problem ?? null}
      error={error ?? (read.error === null ? null : messageOf(read.error))}
      onSave={save}
      onCheck={(id) => {
        const value = connections.get(id)
        if (value !== undefined)
          change(id, { ...value, state: 'checking', reason: null, version: null }, () => client.checkAcpConnection(id))
      }}
      onRemove={(id) => change(id, null, () => client.removeAcpConnection(id))}
      onRefresh={() => {
        setRefreshing(true)
        setError(null)
        void client
          .agentCatalog(true)
          .then(
            (next) => {
              cache.setQueryData(key, take(next))
              void cache.invalidateQueries({ queryKey: key })
            },
            (failure: unknown) => setError(messageOf(failure)),
          )
          .finally(() => setRefreshing(false))
      }}
      onGuide={(url) => {
        window.open(url, '_blank', 'noopener')
      }}
    />
  )
}
