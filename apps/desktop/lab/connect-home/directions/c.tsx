import { useState, type ReactNode } from 'react'
import { Button, Code, CopyButton, Dialog } from '@althar/ui'

import type { Flow } from '../flow'
import { Chunked, CodeField, HostField, LaterProblem, MethodSwitch, NameField, Options } from './parts'
import s from './c.module.css'

/*
 * C · The host side. Connecting a home is half done on the host, so the
 * dialog shows both halves: on the left, the host's terminal, with what to
 * run there and what it prints once Althar has found the home, to read
 * against; on the right, what goes in here. A first home opens on the
 * terminal playing how a home comes about.
 */

export function HostSideDirection({ flow, first, onClose }: { flow: Flow; first: boolean; onClose: () => void }) {
  const [intro, setIntro] = useState(first)
  return (
    <Dialog
      title={intro ? 'Your first home' : 'Connect a home'}
      width={760}
      holding={flow.busy}
      onClose={onClose}
      onSubmit={intro ? () => setIntro(false) : flow.submit}
      actions={
        intro ? (
          <>
            <Button onClick={onClose}>Not now</Button>
            <Button type="submit" variant="signal">
              Set one up
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            {flow.action}
          </>
        )
      }
    >
      <div className={s.split}>
        <Terminal flow={flow} intro={intro} />
        {intro ? (
          <div className={s.side}>
            <p className={s.lede}>A home is a computer that runs Althar for you, so its tasks keep running while this one sleeps.</p>
            <p className={s.copy}>
              Run <Code>althar-host</Code> on a server, or any computer that stays on. Connect it here, and its projects open from the bar,
              each in a window of its own.
            </p>
          </div>
        ) : (
          <div className={s.side} key="form">
            <MethodSwitch flow={flow} className={s.method} />
            {flow.method === 'ssh' ? <HostField flow={flow} focus={!first} /> : <CodeField flow={flow} focus={!first} help={false} />}
            {flow.method === 'ssh' && flow.found === null && <Options flow={flow} />}
            {flow.found !== null && (
              <>
                <p className={s.note}>
                  {flow.method === 'ssh'
                    ? 'Connect only if the host printed the same identity.'
                    : 'Tasks and conversations are available. Approvals need a trusted device.'}
                </p>
                <NameField flow={flow} />
              </>
            )}
            <LaterProblem flow={flow} />
          </div>
        )}
      </div>
    </Dialog>
  )
}

function Line({ children, tone, at = 0 }: { children: ReactNode; tone?: 'dim' | 'live' | 'danger' | 'comment'; at?: number }) {
  return (
    <div className={s.line} data-tone={tone} style={{ animationDelay: `${at}ms` }}>
      {children}
    </div>
  )
}
const Prompt = ({ children }: { children: ReactNode }) => (
  <>
    <span className={s.prompt}>$</span> {children}
  </>
)
const Cursor = () => <span className={s.cursor} aria-hidden="true" />

/** The host's side: what to run there, and what it prints. */
function Terminal({ flow, intro }: { flow: Flow; intro: boolean }) {
  const host = flow.ssh.target.trim()
  const stage = flow.stage
  const command = flow.method === 'ssh' ? 'althar-host status' : 'althar-host pair'
  return (
    <section className={s.terminal} aria-label="On the host" data-intro={intro || undefined}>
      <header className={s.termHead}>
        <span>{intro ? 'How a home comes about' : 'On the host'}</span>
        {!intro && <CopyButton value={command} ghost tone="onDark" className={s.termCopy} />}
      </header>
      <div className={s.screen} key={intro ? 'intro' : flow.method}>
        {intro ? (
          <>
            <Line tone="comment">On a server, or a computer that stays on</Line>
            <Line at={500}>
              <Prompt>althar-host serve</Prompt>
            </Line>
            <Line tone="live" at={1200}>
              ● serving meridian, ledger, atlas
            </Line>
            <Line tone="comment" at={2000}>
              Then, for this computer
            </Line>
            <Line at={2500}>
              <Prompt>althar-host pair</Prompt>
            </Line>
            <Line tone="dim" at={3100}>
              Pairing code k7Qp-3xWm-9fTa
            </Line>
            <Line at={3300}>
              <Cursor />
            </Line>
          </>
        ) : flow.method === 'pair' ? (
          <>
            <Line>
              <Prompt>althar-host pair</Prompt>
            </Line>
            <Line tone="dim">Pairing code ···· ···· ····</Line>
            <Line tone="comment">Paste it on the right; it says which home it is.</Line>
            {flow.found !== null && (
              <>
                <Line tone="live">✓ {flow.found.target.replace('https://', '')}</Line>
                <Line tone="live">
                  <Chunked homeId={flow.found.homeId} className={s.id} />
                </Line>
              </>
            )}
            {stage === 'connecting' && (
              <Line tone="dim">
                pairing this computer <Cursor />
              </Line>
            )}
            {stage === 'connected' && <Line tone="live">● paired, open in its own window</Line>}
            {stage !== 'connecting' && stage !== 'connected' && flow.found === null && (
              <Line>
                <Cursor />
              </Line>
            )}
          </>
        ) : (
          <>
            <Line>
              <Prompt>ssh {host === '' ? <span className={s.hole}>user@host</span> : host}</Prompt>
            </Line>
            <Line>
              <Prompt>althar-host status</Prompt>
            </Line>
            {stage === 'checking' && (
              <Line tone="dim">
                <Cursor />
              </Line>
            )}
            {stage === 'refused' && <Line tone="danger">✕ couldn’t reach {host}</Line>}
            {flow.found !== null ? (
              <>
                <Line tone="dim">it should print</Line>
                <Line tone="live">
                  home <Chunked homeId={flow.found.homeId} className={s.id} />
                </Line>
                {stage === 'connecting' && (
                  <Line tone="dim">
                    connecting <Cursor />
                  </Line>
                )}
                {stage === 'connected' && <Line tone="live">● connected, open in its own window</Line>}
              </>
            ) : (
              stage !== 'checking' &&
              stage !== 'refused' && <Line tone="comment">Run it there; Check host finds what it should print.</Line>
            )}
          </>
        )}
      </div>
    </section>
  )
}
