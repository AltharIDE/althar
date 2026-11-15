import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError } from '@althar/contracts'
import { BrandMark, Button, ConnectActions, ConnectCard, NewRepositoryFields, Problem } from '@althar/ui'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { productBrand } from '../../shared/products'
import s from './PutOnHost.module.css'

/*
 * A project's repository, only on this computer, put on a code host from a
 * finished task's card, where the person asked for it: a new repository
 * there, under the owner they choose, named as the project's repository is,
 * private unless they say; main pushed and followed. From then the project
 * is on that host, and the task's card opens its pull request there.
 */

export const text = {
  title: (host: string, thing: string) => `A new ${thing} on ${host}`,
  create: 'Create and push',
  back: 'Back',
  note: (branch: string) => `Makes it empty, then pushes ${branch}. Tasks open their changes there from then.`,
}

export interface PutOnHostProps {
  projectId: string
  /** The repository, by its slug, as the task names it. */
  repository: string
  /** Its name, as the new one's is unless the person changes it. */
  name: string
  branch: string
  connection: { readonly id: string; readonly name: string; readonly product: Parameters<typeof productBrand>[0]; readonly thing: string }
  onDone: () => void
  onBack: () => void
}

export function PutOnHost({ projectId, repository, name, branch, connection, onDone, onBack }: PutOnHostProps) {
  const { client } = useServices()
  const cache = useQueryClient()
  const owners = useQuery(reads(client).repositoryOwners(connection.id))
  const [ownerId, setOwner] = useState<string | null>(null)
  const [named, setName] = useState(name)
  const [hidden, setHidden] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ readonly at: 'name' | 'card'; readonly said: string } | null>(null)
  const list = owners.data ?? null
  const owner = list?.find((one) => one.id === ownerId) ?? list?.[0] ?? null
  const create = async () => {
    if (owner === null || named.trim() === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await client.publishRepository({
        at: { projectId, repositoryId: repository },
        connectionId: connection.id,
        owner,
        name: named.trim(),
        private: hidden,
      })
      // Its host is known now: the task and the project read again, and the card opens its pull request there.
      await Promise.all([
        cache.invalidateQueries({ queryKey: keys.repositories(projectId) }),
        cache.invalidateQueries({ queryKey: ['thread'] }),
      ]).catch(() => undefined)
      onDone()
    } catch (failure) {
      const taken = failure instanceof ApiError && failure.reason === 'PublishRefused' && failure.why === 'taken'
      setError({ at: taken ? 'name' : 'card', said: messageOf(failure) })
      setBusy(false)
    }
  }
  return (
    <div className={s.card}>
      <ConnectCard
        brand={productBrand(connection.product)}
        title={text.title(connection.name, connection.thing)}
        align="start"
        headingLevel={4}
      >
        <NewRepositoryFields
          owners={list}
          owner={owner?.id ?? null}
          onOwner={setOwner}
          name={named}
          onName={(next) => {
            setName(next)
            if (error?.at === 'name') setError(null)
          }}
          visibility={hidden ? 'private' : 'public'}
          onVisibility={(next) => setHidden(next === 'private')}
          {...(error?.at === 'name' ? { error: error.said } : {})}
        />
        <p className={s.note}>
          <BrandMark brand={productBrand(connection.product)} size={12} />
          {text.note(branch)}
        </p>
        {error?.at === 'card' && (
          <Problem size="small" as="p">
            {error.said}
          </Problem>
        )}
        <ConnectActions align="start">
          <Button variant="quiet" onClick={onBack} disabled={busy}>
            {text.back}
          </Button>
          {/* oxlint-disable-next-line althar/press-at-once -- A form the code host checks (the name may be taken there): busy until it answers, its error at the name. */}
          <Button variant="signal" busy={busy} disabled={owner === null || named.trim() === ''} onClick={() => void create()}>
            {text.create}
          </Button>
        </ConnectActions>
      </ConnectCard>
    </div>
  )
}
