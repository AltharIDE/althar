import type { ClientPage, RegisteredClient } from '@althar/contracts'
import type { PairedPhone, PairPhoneState } from '@althar/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { useServices } from '../../data/services'
import { useNow } from '../../shared/time'

/*
 * Pairing a phone with the window's home, wherever the window offers it (the
 * homes menu, Settings › Computers): whether phones reach the home, letting
 * them in where this window can, a code made as it opens and asked after
 * until a phone uses it or its five minutes run out, and the phones paired.
 * Every press shows its result at once; the home catches up behind, and a
 * refusal comes back in the home's own words.
 */

const STATUS_EVERY = 1_500
const ACCESS = ['phones', 'access'] as const
const DEVICES = ['phones', 'devices'] as const

const problemOf = (error: unknown) =>
  error instanceof Error && error.message !== '' ? error.message : 'The home didn’t answer. Try again.'
/** Refusals that trying again won't change: this window may not make codes. */
const refused = (error: unknown) =>
  typeof error === 'object' && error !== null && 'reason' in error && (error as { reason: unknown }).reason === 'Forbidden'

/** When a device paired, in words: Today, Yesterday, or the day. */
export const pairedWords = (createdAt: string, now: string) => {
  const day = (iso: string) => new Date(iso).toDateString()
  if (day(createdAt) === day(now)) return 'Today'
  if (day(createdAt) === day(new Date(Date.parse(now) - 86_400_000).toISOString())) return 'Yesterday'
  return new Date(createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export const phoneOf = (device: RegisteredClient, now: string, fresh: ReadonlySet<string>): PairedPhone => ({
  id: device.deviceId,
  name: device.name,
  paired: pairedWords(device.createdAt, now),
  ...(fresh.has(device.deviceId) ? { fresh: true } : {}),
})

/** What pairs with a code (phones, and computers that connected the same way), and isn't taken off. */
const pairedOnly = (page: ClientPage) => page.clients.filter((device) => device.role === 'socket' && device.revokedAt === null)

/** The phones the window's home has paired, kept fresh, with Remove at once. */
export function usePairedPhones() {
  const { client } = useServices()
  const queries = useQueryClient()
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const [problem, setProblem] = useState<string | null>(null)
  const devices = useQuery({
    queryKey: DEVICES,
    queryFn: async () => {
      const all: RegisteredClient[] = []
      let after: string | undefined
      for (let page = 0; page < 10; page++) {
        const got = await client.pairedDevices(after)
        all.push(...pairedOnly(got))
        if (got.next === null) break
        after = got.next
      }
      return all
    },
  })
  const removing = useMutation({
    mutationFn: (id: string) => client.removePairedDevice(id),
    onMutate: (id) => {
      setProblem(null)
      const was = queries.getQueryData<ReadonlyArray<RegisteredClient>>(DEVICES)
      queries.setQueryData<ReadonlyArray<RegisteredClient>>(DEVICES, (list) => list?.filter((device) => device.deviceId !== id))
      return { was }
    },
    onError: (error, _id, context) => {
      queries.setQueryData(DEVICES, context?.was)
      setProblem(problemOf(error))
    },
  })
  const paired = (deviceId: string) => {
    setFresh((was) => new Set([...was, deviceId]))
    void queries.invalidateQueries({ queryKey: DEVICES })
  }
  return { devices: devices.data ?? null, fresh, problem, remove: (id: string) => removing.mutate(id), paired }
}

/** One pairing, from opening to Done: what PairPhone shows, and what its presses do. */
export function usePairing(onPaired: (deviceId: string) => void) {
  const { client } = useServices()
  const queries = useQueryClient()
  // Each new code is a round of its own: Pair another phone, New code, Try again.
  const [round, setRound] = useState(0)
  const [paired, setPaired] = useState<{ round: number; device: string } | null>(null)
  const [ranOut, setRanOut] = useState<number | null>(null)
  const access = useQuery({ queryKey: ACCESS, queryFn: () => client.phoneAccess(), staleTime: 0, retry: false })
  const reachable = access.data !== undefined && access.data.origin !== null
  const made = useQuery({
    queryKey: ['phones', 'code', round],
    queryFn: () => client.createPairingCode(),
    enabled: reachable,
    // A code is made once for its round, never again behind the person's back.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const letting = useMutation({
    mutationFn: () => client.setPhoneAccess(true),
    onSuccess: (now) => queries.setQueryData(ACCESS, now),
  })
  const code = made.data
  const done = paired !== null && paired.round === round ? paired : null
  const out = code !== undefined && done === null && ranOut !== round ? code : null
  const now = useNow(out !== null)
  const left = out === null ? 0 : Math.max(0, out.expiresAt - Date.parse(now))
  const waiting = left > 0 ? out : null
  // Asked after while it waits, until a phone uses it; the home says when it ran out too.
  useQuery({
    queryKey: ['phones', 'status', waiting?.tokenHash ?? null],
    enabled: waiting !== null,
    refetchInterval: STATUS_EVERY,
    gcTime: 0,
    queryFn: async () => {
      if (waiting === null) return null
      const status = await client.pairingStatus(waiting.tokenHash)
      if (status.state === 'paired') {
        setPaired({ round, device: status.device.name })
        onPaired(status.device.deviceId)
      } else if (status.state === 'expired') setRanOut(round)
      return status
    },
  })
  const again = () => {
    setRound((was) => was + 1)
    void queries.invalidateQueries({ queryKey: ACCESS })
  }
  const state: PairPhoneState =
    access.error !== null
      ? { kind: 'failed', problem: problemOf(access.error), again: !refused(access.error) }
      : access.data === undefined
        ? { kind: 'making' }
        : access.data.origin === null
          ? {
              kind: 'closed',
              switchable: access.data.switchable,
              letting: letting.isPending,
              ...(letting.error === null ? {} : { problem: problemOf(letting.error) }),
            }
          : made.error !== null
            ? { kind: 'failed', problem: problemOf(made.error), again: !refused(made.error) }
            : code === undefined
              ? { kind: 'making' }
              : done !== null
                ? { kind: 'paired', code: code.code, device: done.device }
                : waiting === null
                  ? { kind: 'expired', code: code.code, link: code.link }
                  : { kind: 'waiting', code: code.code, link: code.link, left }
  // Where phones reach the home, in a line: This Mac's by its name on the Wi-Fi.
  const host = access.data?.origin == null ? null : new URL(access.data.origin).hostname
  const reach =
    host === null ? null : host.endsWith('.local') ? `Phones on the same Wi-Fi reach it, at ${host}.` : `Phones reach it at ${host}.`
  return { state, letIn: () => letting.mutate(), again, reach }
}
