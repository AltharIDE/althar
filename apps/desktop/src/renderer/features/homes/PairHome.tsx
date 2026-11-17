import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button, Code, Dialog, Field, Problem } from '@althar/ui'

import type { HomesHost } from '../../../homes'
import { Identity } from './ConnectHome'
import { homeProblem } from './useHomes'
import s from './Homes.module.css'

/** A code identifies the home and its TLS key before the connection credential is exchanged. */
export function PairHome({ homes, onClose, choice }: { homes: HomesHost; onClose: () => void; choice: ReactNode }) {
  const id = useId()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [info, setInfo] = useState<{ origin: string; homeId: string; expiresAt: number } | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      void homes.cancelCheck().catch(() => undefined)
    }
  }, [homes])
  useEffect(() => {
    let current = true
    if (code.trim() !== '' && homes.pairingInfo !== undefined)
      void homes
        .pairingInfo(code.trim())
        .then((next) => {
          if (current) setInfo(next)
        })
        .catch((error: unknown) => {
          if (current) setProblem(homeProblem(error))
        })
    return () => {
      current = false
    }
  }, [code, homes])
  const pair = () => {
    if (homes.pair === undefined || info === null || pending || name.trim() === '') return
    setPending(true)
    setProblem(null)
    void homes
      .pair(code.trim(), name.trim())
      .then(() => {
        if (live.current) {
          setCode('')
          onClose()
        }
      })
      .catch((error: unknown) => {
        if (live.current) {
          setPending(false)
          setProblem(homeProblem(error))
        }
      })
  }
  return (
    <Dialog
      title="Connect a home"
      width={480}
      holding={pending}
      onClose={onClose}
      onSubmit={pair}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="signal" busy={pending} disabled={pending || info === null || name.trim() === ''}>
            {pending ? 'Pairing…' : 'Pair and open'}
          </Button>
        </>
      }
    >
      <div className={s.form}>
        {choice}
        <label className={s.field} htmlFor={`${id}-code`}>
          <span>Pairing code</span>
          <Field
            id={`${id}-code`}
            type="password"
            value={code}
            maxLength={8192}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setCode(event.currentTarget.value)
              setInfo(null)
              setProblem(null)
            }}
          />
        </label>
        <p className={s.note}>
          On the host, run <Code>althar-host pair</Code> to create a code.
        </p>
        {problem !== null && <Problem>{problem}</Problem>}
        {info !== null && (
          <section className={s.check} aria-label="The home in this code">
            <strong className={s.target}>{info.origin}</strong>
            <Identity homeId={info.homeId} />
            <p className={s.note}>Tasks and conversations are available. Approvals need a trusted device.</p>
          </section>
        )}
        <label className={s.field} htmlFor={`${id}-name`}>
          <span>Name</span>
          <Field
            id={`${id}-name`}
            value={name}
            maxLength={120}
            disabled={pending}
            autoComplete="off"
            placeholder="My server"
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </label>
      </div>
    </Dialog>
  )
}
