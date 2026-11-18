import { useState } from 'react'
import { Button, Code, CopyButton, Dialog, Icon, LiveDot, ProjectInk, ProjectMark, Spinner } from '@althar/ui'

import type { Flow } from '../flow'
import { Chunked, CodeField, HostField, LaterProblem, MethodSwitch, NameField, Options } from './parts'
import s from './a.module.css'

/*
 * A · The drawing. The Welcome's drawing board, in the dialog: this computer
 * and the home being made, joined by a line drawn as the connection stands:
 * drafted, being reached, found, connecting, connected, or broken where it
 * failed. The home's card fills in as it is typed and found. A first home
 * opens on the same drawing, with work running on the home.
 */

const SAMPLE = [
  { id: 'prj_meridian', ink: ProjectInk.Clay },
  { id: 'prj_ledger', ink: ProjectInk.Moss },
  { id: 'prj_atlas', ink: ProjectInk.Indigo },
]

export function DrawingDirection({ flow, first, onClose }: { flow: Flow; first: boolean; onClose: () => void }) {
  const [intro, setIntro] = useState(first)
  const stage = intro ? 'intro' : flow.stage
  return (
    <Dialog
      title={intro ? 'Your first home' : 'Connect a home'}
      width={660}
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
      <div className={s.board} data-stage={stage}>
        <div className={s.card}>
          <span className={s.glyph}>
            <Icon name="computer" size={15} />
          </span>
          <span className={s.words}>
            <span className={s.name}>This computer</span>
            {intro && <span className={s.where}>Can sleep</span>}
          </span>
        </div>
        <Wire stage={stage} method={flow.method} />
        <HomeCard flow={flow} intro={intro} />
      </div>
      {intro ? (
        <div className={s.intro}>
          <h3 className={s.lede}>Work that keeps going while this computer sleeps</h3>
          <p className={s.copy}>
            A home is a computer that runs Althar for you, such as a server that stays on. Its tasks run there, and you open its projects
            from here, each in a window of its own.
          </p>
          <p className={s.need}>
            It needs <Code>althar-host</Code> running on that computer.
          </p>
        </div>
      ) : (
        <div className={s.form} key="form">
          <MethodSwitch flow={flow} className={s.method} />
          {flow.method === 'ssh' ? <HostField flow={flow} focus={!first} /> : <CodeField flow={flow} focus={!first} />}
          {flow.method === 'ssh' && flow.found === null && <Options flow={flow} />}
          {flow.found !== null && (
            <>
              <p className={s.note}>
                {flow.method === 'ssh' ? (
                  <>
                    On the host, <Code>althar-host status</Code> prints the same identity. Connect only if it does.
                  </>
                ) : (
                  'Tasks and conversations are available. Approvals need a trusted device.'
                )}
              </p>
              <NameField flow={flow} />
            </>
          )}
          <LaterProblem flow={flow} />
        </div>
      )}
    </Dialog>
  )
}

/** The line between the two: how the connection stands, with how it's made over it. */
function Wire({ stage, method }: { stage: string; method: 'pair' | 'ssh' }) {
  const broken = stage === 'refused'
  return (
    <div className={s.wire} aria-hidden="true">
      <span className={s.how}>{stage === 'intro' ? 'always on' : method === 'ssh' ? 'ssh' : 'https'}</span>
      <svg className={s.line} viewBox="0 0 100 12" preserveAspectRatio="none">
        {broken ? (
          <>
            <line x1="0" y1="6" x2="40" y2="6" vectorEffect="non-scaling-stroke" />
            <line x1="60" y1="6" x2="100" y2="6" vectorEffect="non-scaling-stroke" />
          </>
        ) : (
          <line x1="0" y1="6" x2="100" y2="6" vectorEffect="non-scaling-stroke" />
        )}
        {(stage === 'connecting' || stage === 'intro') && (
          <line className={s.comet} x1="0" y1="6" x2="100" y2="6" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <span className={s.node}>
        {stage === 'checking' && <Spinner size="small" />}
        {broken && <Icon name="close" size={11} />}
        {stage === 'connected' && <Icon name="check" size={12} />}
      </span>
    </div>
  )
}

function HomeCard({ flow, intro }: { flow: Flow; intro: boolean }) {
  const found = flow.found !== null && !intro
  const name = intro ? 'Your server' : flow.name.trim()
  const where = intro ? '' : flow.where
  return (
    <div className={s.card} data-home="" data-found={found || intro || undefined}>
      <div className={s.head}>
        <span className={s.glyph}>
          <Icon name="home" size={15} />
        </span>
        <span className={s.words}>
          <span className={s.name} data-empty={name === '' || undefined}>
            {name === '' ? 'New home' : name}
          </span>
          {!intro && (
            <span className={s.where} data-empty={where === '' || undefined}>
              {where === '' ? (flow.method === 'ssh' ? 'user@host' : 'From its pairing code') : where}
            </span>
          )}
        </span>
        {flow.stage === 'connected' && !intro && (
          <span className={s.live}>
            <LiveDot />
            Open
          </span>
        )}
      </div>
      {intro && (
        <span className={s.shelf}>
          {SAMPLE.map((one) => (
            <ProjectMark key={one.id} seed={one.id} ink={one.ink} size={26} running />
          ))}
        </span>
      )}
      <div className={s.reveal} data-on={found || undefined}>
        <div className={s.revealInner}>
          {flow.found !== null && (
            <div className={s.identity}>
              <Chunked homeId={flow.found.homeId} className={s.homeId} />
              <CopyButton value={flow.found.homeId} ghost className={s.copyId} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
