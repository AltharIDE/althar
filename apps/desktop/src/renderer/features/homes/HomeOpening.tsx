import { Button, Icon, Problem, TitleBar } from '@althar/ui'

import type { HomesHost, RemoteHome } from '../../../homes'
import type { Host } from '../../data/services'
import { useHostChrome } from '../../shared/useWindowChrome'
import { Chip } from './HomeConnections'
import { Working } from './ConnectHome'
import s from './Homes.module.css'

/*
 * A home's window before it first connects: the home's name and host, and
 * how it is going; where it couldn't connect, why, with Try again, or Close
 * window. The chip is in its bar, as it is once the window is open.
 */
export function HomeOpening({ host, homes, home, problem }: { host: Host; homes: HomesHost; home: RemoteHome; problem: string | null }) {
  const chrome = useHostChrome(host)
  return (
    <div className={s.opening}>
      <TitleBar {...chrome} end={<Chip homes={homes} />}>
        {null}
      </TitleBar>
      <main className={s.openingBody}>
        <Icon name={problem === null ? 'home' : 'unlinked'} size={28} className={s.openingGlyph} />
        <h1 className={s.openingName}>{home.name}</h1>
        <span className={s.target}>{home.ssh.target}</span>
        <div className={s.openingState}>
          {problem === null ? (
            <Working>Connecting over SSH…</Working>
          ) : (
            <>
              <Problem size="small">{problem}</Problem>
              <span className={s.openingActions}>
                <Button onClick={() => host.window('close')}>Close window</Button>
                <Button variant="signal" onClick={() => void homes.reconnect().catch(() => undefined)}>
                  Try again
                </Button>
              </span>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
