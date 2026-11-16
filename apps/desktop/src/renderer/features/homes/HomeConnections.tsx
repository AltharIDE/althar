import { useEffect, useState } from 'react'
import { Button, Dialog, Problem } from '@althar/ui'

import type { Host } from '../../data/services'
import { useServices } from '../../data/services'
import { HomesDialog } from './HomesDialog'
import { homeProblem, showHomes, useHomeState } from './useHomes'
import s from './Homes.module.css'

export function HomeButton() {
  const { host } = useServices()
  const state = useHomeState(host.homes)
  if (host.homes === undefined) return null
  return (
    <Button className={s.trigger} onClick={showHomes} aria-label="Homes">
      {state?.current.kind === 'ssh' ? state.current.home.name : 'Homes'}
      {state?.current.kind === 'ssh' && <span className={s.note}> SSH</span>}
    </Button>
  )
}

/** Available before the first project and even when a host cannot connect. */
export function HomeConnections({ host, ready }: { host: Host; ready: boolean }) {
  const [open, setOpen] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const state = useHomeState(host.homes)
  useEffect(() => {
    const show = () => setOpen(true)
    const off = host.homes?.onOpen(show)
    window.addEventListener('althar:show-homes', show)
    return () => {
      off?.()
      window.removeEventListener('althar:show-homes', show)
    }
  }, [host.homes])
  if (host.homes === undefined) return null
  if (open) return <HomesDialog homes={host.homes} onClose={() => setOpen(false)} />
  if (!ready || state?.current.kind !== 'ssh' || state.connection !== 'disconnected') return null
  return (
    <Dialog
      title={`Disconnected from ${state.current.home.name}`}
      description="Work continues on the home. Reconnect to carry on."
      onClose={showHomes}
      holding
      actions={
        <>
          <Button onClick={showHomes}>Homes</Button>
          <Button
            variant="ink"
            disabled={reconnecting}
            onClick={() => {
              setReconnecting(true)
              setProblem(null)
              void host.homes!.reconnect().catch((error: unknown) => {
                setReconnecting(false)
                setProblem(homeProblem(error))
              })
            }}
          >
            {reconnecting ? 'Reconnecting…' : 'Reconnect'}
          </Button>
        </>
      }
    >
      <p className={s.note}>{state.problem}</p>
      {problem !== null && <Problem>{problem}</Problem>}
    </Dialog>
  )
}
