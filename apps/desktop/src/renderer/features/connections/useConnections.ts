import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ConnectionList, Product } from '@althar/contracts'
import type { ServiceSignIn, ServiceToken } from '@althar/ui'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * The connections view model (docs/architecture/06): the code hosts and
 * trackers on this Mac, signing in to one, by its own sign-in or a pasted
 * token, and disconnecting. A sign-in under way is asked about until it ends;
 * one in the browser opens the browser itself.
 */

/** How often a sign-in under way is asked how it stands. */
const POLL = 1_500

export interface ConnectionsModel {
  readonly list: ConnectionList | null
  /** A sign-in under way, or how one ended, as the kit shows it. */
  readonly signingIn: ServiceSignIn | null
  /** The service whose token is being checked. */
  readonly saving: string | null
  readonly tokenError: { readonly service: string; readonly message: string } | null
  readonly error: string | null
  readonly signIn: (product: Product) => Promise<void>
  readonly cancelSignIn: () => Promise<void>
  readonly connectToken: (product: Product, token: ServiceToken) => Promise<void>
  readonly disconnect: (connectionId: string) => Promise<void>
}

export const useConnections = (): ConnectionsModel => {
  const { client, cache } = useServices()
  // Read again when a connection changes, as the window hears it.
  const listRead = useQuery(reads(client).connections())
  const list = listRead.data ?? null
  const [signingIn, setSigningIn] = useState<ServiceSignIn | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<{ readonly service: string; readonly message: string } | null>(null)
  const [failed, setError] = useState<string | null>(null)
  const error = failed ?? (listRead.error === null ? null : messageOf(listRead.error))
  const flow = useRef<{ readonly id: string; readonly product: Product } | null>(null)

  const load = useCallback(() => cache.refetchQueries({ queryKey: keys.connections }), [cache])

  // A sign-in under way is asked how it stands, until it ends.
  useEffect(() => {
    if (signingIn === null || signingIn.kind === 'ended') return
    const timer = setInterval(() => {
      const current = flow.current
      if (current === null) return
      client.getSignIn(current.id).then(
        (state) => {
          if (flow.current?.id !== current.id || state.state === 'waiting') return
          flow.current = null
          setSigningIn(state.state === 'done' ? null : { service: current.product, kind: 'ended', message: state.message })
          if (state.state === 'done') void load()
        },
        (failure: unknown) => {
          flow.current = null
          setSigningIn({ service: current.product, kind: 'ended', message: messageOf(failure) })
        },
      )
    }, POLL)
    return () => clearInterval(timer)
  }, [client, signingIn, load])

  const signIn = useCallback(
    async (product: Product) => {
      setError(null)
      try {
        const started = await client.startSignIn(product)
        flow.current = { id: started.flowId, product }
        if (started.kind === 'device')
          setSigningIn({ service: product, kind: 'device', code: started.userCode, url: started.verificationUri })
        else {
          setSigningIn({ service: product, kind: 'browser', url: started.url })
          // The window opens web pages in the person's browser.
          window.open(started.url, '_blank')
        }
      } catch (failure) {
        setSigningIn({ service: product, kind: 'ended', message: messageOf(failure) })
      }
    },
    [client],
  )

  const cancelSignIn = useCallback(async () => {
    const current = flow.current
    flow.current = null
    setSigningIn(null)
    if (current !== null) await client.cancelSignIn(current.id).catch(() => undefined)
  }, [client])

  const connectToken = useCallback(
    async (product: Product, token: ServiceToken) => {
      setTokenError(null)
      setSaving(product)
      try {
        await client.connectToken({
          product,
          token: token.token,
          ...(token.instance === undefined ? {} : { webUrl: token.instance }),
          ...(token.user === undefined ? {} : { user: token.user }),
          ...(token.key === undefined ? {} : { key: token.key }),
        })
        await load()
      } catch (failure) {
        setTokenError({ service: product, message: messageOf(failure) })
      } finally {
        setSaving(null)
      }
    },
    [client, load],
  )

  const disconnect = useCallback(
    async (connectionId: string) => {
      setError(null)
      try {
        await client.disconnect(connectionId)
        await load()
      } catch (failure) {
        setError(messageOf(failure))
      }
    },
    [client, load],
  )

  return { list, signingIn, saving, tokenError, error, signIn, cancelSignIn, connectToken, disconnect }
}
