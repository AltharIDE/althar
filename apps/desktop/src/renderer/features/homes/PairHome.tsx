import { PAIRING_CODE_MAX_LENGTH } from '@althar/contracts'
import { useEffect, useId, useRef, useState } from 'react'
import { Button, Code, Field } from '@althar/ui'

import type { HomesHost } from '../../../homes'
import { FoundHome, Refusal, type Step } from './ConnectHome'
import { homeProblem } from './useHomes'
import s from './Homes.module.css'

/** A code identifies the home and its TLS key before the connection credential is exchanged. */
export function usePairStep(homes: HomesHost, onClose: () => void, focus: boolean): Step {
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
  return {
    busy: pending,
    leave: () => void homes.cancelCheck().catch(() => undefined),
    submit: pair,
    action: (
      <Button type="submit" variant="signal" busy={pending} disabled={pending || info === null || name.trim() === ''}>
        {pending ? 'Pairing…' : 'Pair and open'}
      </Button>
    ),
    body: (
      <>
        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${id}-code`}>
            Pairing code
          </label>
          <Field
            id={`${id}-code`}
            type="password"
            value={code}
            maxLength={PAIRING_CODE_MAX_LENGTH}
            disabled={pending}
            invalid={problem !== null && info === null}
            aria-describedby={`${id}-help`}
            autoComplete="off"
            spellCheck={false}
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the dialog is opened to paste a code; its first field takes the keys.
            autoFocus={focus}
            onChange={(event) => {
              setCode(event.currentTarget.value)
              setInfo(null)
              setProblem(null)
            }}
          />
          {problem !== null ? (
            <Refusal problem={problem} id={`${id}-help`} />
          ) : (
            <p className={s.help} id={`${id}-help`}>
              On the host, run <Code>althar-host pair</Code> to create a code.
            </p>
          )}
        </div>
        {info !== null && (
          <FoundHome where={info.origin} homeId={info.homeId} label="The home in this code">
            Tasks and conversations are available. Approvals need a trusted device.
          </FoundHome>
        )}
        <div className={s.field}>
          <label className={s.fieldLabel} htmlFor={`${id}-name`}>
            Name
          </label>
          <Field
            id={`${id}-name`}
            value={name}
            maxLength={120}
            disabled={pending}
            autoComplete="off"
            placeholder="My server"
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </div>
      </>
    ),
  }
}
