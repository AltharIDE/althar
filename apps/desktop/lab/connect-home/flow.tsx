import { PAIRING_CODE_MAX_LENGTH } from '@althar/contracts'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@althar/ui'

import type { HomesHost } from '../../src/homes'
import { useConnect } from '../../src/renderer/features/homes/ConnectHome'
import { homeProblem, nameFrom } from '../../src/renderer/features/homes/useHomes'

/*
 * What every direction draws: the app's own connection form (useConnect),
 * and pairing as PairHome has it, under one model. Where the connection
 * stands is one word (Stage) a direction draws as it likes.
 */

export type Method = 'pair' | 'ssh'
export type Stage = 'empty' | 'draft' | 'checking' | 'refused' | 'found' | 'connecting' | 'connected'
export { PAIRING_CODE_MAX_LENGTH }

/** Pairing, as PairHome has it, with the name started from the host's once its code is read. */
const usePair = (homes: HomesHost, onDone: () => void) => {
  const [name, setNameNow] = useState('')
  const [named, setNamed] = useState(false)
  const [code, setCodeNow] = useState('')
  const [info, setInfo] = useState<{ origin: string; homeId: string; expiresAt: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    let current = true
    if (code.trim() !== '' && homes.pairingInfo !== undefined)
      void homes
        .pairingInfo(code.trim())
        .then((next) => {
          if (!current) return
          setInfo(next)
          if (!named) setNameNow(nameFrom(new URL(next.origin).hostname))
        })
        .catch((error: unknown) => {
          if (current) setProblem(homeProblem(error))
        })
    return () => {
      current = false
    }
  }, [code, homes, named])
  return {
    code,
    name,
    info,
    problem,
    pending,
    setCode: (value: string) => {
      setCodeNow(value)
      setInfo(null)
      setProblem(null)
    },
    setName: (value: string) => {
      setNamed(true)
      setNameNow(value)
    },
    pair: () => {
      if (homes.pair === undefined || info === null || pending || name.trim() === '') return
      setPending(true)
      setProblem(null)
      void homes
        .pair(code.trim(), name.trim())
        .then(onDone)
        .catch((error: unknown) => {
          setPending(false)
          setProblem(homeProblem(error))
        })
    },
  }
}

export const useFlow = (homes: HomesHost, onClose: () => void, start: Method = 'pair') => {
  const [method, setMethodNow] = useState<Method>(start)
  const [connected, setConnected] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  // Connected: shown for a moment, as its window opens, then the dialog goes.
  const done = () => {
    setConnected(true)
    timer.current = setTimeout(onClose, 1400)
  }
  const ssh = useConnect(homes, done)
  const pair = usePair(homes, done)
  const sshStage = (): Stage => {
    if (connected) return 'connected'
    if (ssh.phase === 'connecting') return 'connecting'
    if (ssh.phase === 'checked') return 'found'
    if (ssh.phase === 'checking') return 'checking'
    if (ssh.phase === 'refused') return 'refused'
    return ssh.target.trim() === '' ? 'empty' : 'draft'
  }
  const pairStage = (): Stage => {
    if (connected) return 'connected'
    if (pair.pending) return 'connecting'
    if (pair.info !== null) return 'found'
    if (pair.problem !== null) return 'refused'
    return pair.code.trim() === '' ? 'empty' : 'checking'
  }
  const stage = method === 'ssh' ? sshStage() : pairStage()
  const found = method === 'ssh' ? ssh.checked : pair.info === null ? null : { homeId: pair.info.homeId, target: pair.info.origin }
  const name = method === 'ssh' ? ssh.name : pair.name
  const busy = stage === 'checking' && method === 'ssh' ? true : stage === 'connecting' || stage === 'connected'
  const submit = () => {
    if (method === 'pair') return pair.pair()
    if (stage === 'found') return ssh.connect()
    ssh.check()
  }
  const ready =
    method === 'pair'
      ? pair.info !== null && pair.name.trim() !== ''
      : stage === 'found'
        ? ssh.name.trim() !== ''
        : ssh.target.trim() !== ''
  const label =
    method === 'pair'
      ? stage === 'connecting' || stage === 'connected'
        ? 'Pairing…'
        : 'Pair and open'
      : stage === 'connecting' || stage === 'connected'
        ? 'Connecting…'
        : stage === 'checking'
          ? 'Checking…'
          : stage === 'found'
            ? 'Connect'
            : 'Check host'
  const signal = method === 'pair' || stage === 'found' || stage === 'connecting' || stage === 'connected'
  return {
    method,
    stage,
    ssh,
    pair,
    found,
    name,
    busy,
    problem: method === 'ssh' ? (ssh.phase === 'refused' ? ssh.problem : null) : pair.problem,
    /** Where the home is, as typed or as found. */
    where: method === 'ssh' ? ssh.target.trim() : (pair.info?.origin ?? ''),
    setName: (value: string) => (method === 'ssh' ? ssh.setName(value) : pair.setName(value)),
    setMethod: (next: Method) => {
      if (next === method) return
      if (method === 'ssh') ssh.reset(ssh.target, ssh.options)
      else void homes.cancelCheck().catch(() => undefined)
      setMethodNow(next)
    },
    submit,
    action: (
      <Button
        type="submit"
        variant={signal ? 'signal' : undefined}
        busy={stage === 'checking' || stage === 'connecting' || stage === 'connected'}
        disabled={!ready || busy}
      >
        {label}
      </Button>
    ),
  }
}
export type Flow = ReturnType<typeof useFlow>
