import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Code, CopyButton, Dialog, Icon, LiveDot, Segmented, type IconName } from '@althar/ui'

import type { Flow, Method } from '../flow'
import { Chunked, CodeField, HostField, LaterProblem, NameField, Options } from './parts'
import chip from '../../../src/renderer/features/homes/Homes.module.css'
import s from './b.module.css'

/*
 * B · The setup. A few short steps, as the Welcome walks its own: how the
 * home is reached, reaching it, then confirming it is the one meant, with
 * its identity in groups to read against the host's and its name as the bar
 * will show it. Steps slide; the dialog's height follows. A first home
 * starts with what a home is, in three lines with the real pieces.
 */

type Step = 'intro' | 'how' | 'reach' | 'confirm'
const STEPS: ReadonlyArray<{ key: Step; label: string }> = [
  { key: 'how', label: 'How' },
  { key: 'reach', label: 'Reach it' },
  { key: 'confirm', label: 'Confirm' },
]

export function SetupDirection({ flow, first, onClose }: { flow: Flow; first: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>(first ? 'intro' : 'how')
  const [chosen, setChosen] = useState<Method | null>(null)
  // A host found moves on to confirming it; a found home lost (an edit, a refusal) comes back to reaching it.
  const found = flow.found !== null
  useEffect(() => {
    if (found && step === 'reach' && flow.method === 'ssh') setStep('confirm')
    if (!found && step === 'confirm') setStep('reach')
  }, [found, step, flow.method])
  const choose = (method: Method) => {
    setChosen(method)
    flow.setMethod(method)
    setTimeout(() => setStep('reach'), 140)
  }
  const order: Step[] = first ? ['intro', 'how', 'reach', 'confirm'] : ['how', 'reach', 'confirm']
  const at = order.indexOf(step)
  const back = at > 0 && step !== 'intro' && !flow.busy ? () => setStep(order[at - 1]!) : undefined
  const primary = () => {
    if (step === 'intro') return setStep('how')
    if (step === 'how') return chosen !== null && setStep('reach')
    if (step === 'reach' && flow.method === 'pair') return found && setStep('confirm')
    flow.submit()
  }
  const action =
    step === 'intro' ? (
      <Button type="submit" variant="signal">
        Get started
      </Button>
    ) : step === 'how' ? (
      <Button type="submit" disabled={chosen === null}>
        Continue
      </Button>
    ) : step === 'reach' && flow.method === 'pair' ? (
      <Button type="submit" disabled={!found}>
        Continue
      </Button>
    ) : (
      flow.action
    )
  return (
    <Dialog
      title={step === 'intro' ? 'Your first home' : 'Connect a home'}
      width={520}
      holding={flow.busy}
      onClose={onClose}
      onBack={back}
      onSubmit={primary}
      actions={
        <>
          <Button onClick={onClose}>{step === 'intro' ? 'Not now' : 'Cancel'}</Button>
          {action}
        </>
      }
    >
      {step !== 'intro' && (
        <ol className={s.track} aria-label="Steps">
          {STEPS.map((one, index) => {
            const now = STEPS.findIndex((x) => x.key === step)
            return (
              <li key={one.key} className={s.mark} data-done={index < now || undefined} data-now={index === now || undefined}>
                <span className={s.bar} />
                {one.label}
              </li>
            )
          })}
        </ol>
      )}
      <Slides at={at} done={flow.stage === 'connected'}>
        {order.map((key) => (
          <div key={key} className={s.slide} inert={key !== step || undefined}>
            {key === 'intro' && <Intro />}
            {key === 'how' && <How chosen={chosen} onChoose={choose} />}
            {key === 'reach' && step === 'reach' && <Reach flow={flow} />}
            {key === 'reach' && step !== 'reach' && <Reach flow={flow} still />}
            {key === 'confirm' && <Confirm flow={flow} />}
          </div>
        ))}
      </Slides>
    </Dialog>
  )
}

/** The steps side by side, the one shown slid into view; the box's height follows the one shown. */
function Slides({ at, done, children }: { at: number; done: boolean; children: ReactNode }) {
  const track = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const shown = track.current?.children[at] as HTMLElement | undefined
    if (shown === undefined) return
    const observer = new ResizeObserver(() => setHeight(shown.offsetHeight))
    observer.observe(shown)
    setHeight(shown.offsetHeight)
    return () => observer.disconnect()
  }, [at])
  return (
    <div className={s.slides} style={{ height }} data-done={done || undefined}>
      <div ref={track} className={s.slideTrack} style={{ transform: `translateX(calc(${-at} * (100% + 32px)))` }}>
        {children}
      </div>
    </div>
  )
}

function Intro() {
  return (
    <div className={s.intro}>
      <p className={s.lede}>A home is a computer that runs Althar for you, so its tasks keep running while this one sleeps.</p>
      <ol className={s.how}>
        <li>
          <span className={s.number}>1</span>
          <span className={s.howWords}>
            <strong>Run the host there</strong>
            <span>On a server, or a computer that stays on.</span>
          </span>
          <code className={s.cmd}>althar-host serve</code>
        </li>
        <li>
          <span className={s.number}>2</span>
          <span className={s.howWords}>
            <strong>Connect it here</strong>
            <span>With a pairing code, or SSH.</span>
          </span>
          <Segmented
            label="Example"
            value="pair"
            onChange={() => undefined}
            className={s.sample}
            options={[
              { value: 'pair', label: 'Code' },
              { value: 'ssh', label: 'SSH' },
            ]}
          />
        </li>
        <li>
          <span className={s.number}>3</span>
          <span className={s.howWords}>
            <strong>Open its projects from the bar</strong>
            <span>Each in a window of its own.</span>
          </span>
          <span className={`${chip.chip} ${s.chipSample}`}>
            <Icon name="home" size={14} />
            <span className={chip.chipName}>vps</span>
          </span>
        </li>
      </ol>
    </div>
  )
}

function How({ chosen, onChoose }: { chosen: Method | null; onChoose: (method: Method) => void }) {
  const option = (value: Method, icon: IconName, title: string, line: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={chosen === value}
      aria-label={title}
      className={s.choice}
      onClick={() => onChoose(value)}
    >
      <span className={s.choiceGlyph}>
        <Icon name={icon} size={16} />
      </span>
      <span className={s.choiceTitle}>{title}</span>
      <span className={s.choiceLine}>{line}</span>
    </button>
  )
  return (
    <div className={s.choices} role="radiogroup" aria-label="How it's reached">
      {option('pair', 'lock', 'Pairing code', 'A one-time code from the host. Over HTTPS, no SSH needed.')}
      {option('ssh', 'terminal', 'SSH', 'The way you reach it already, with your SSH config and keys.')}
    </div>
  )
}

function Reach({ flow, still = false }: { flow: Flow; still?: boolean }) {
  return (
    <div className={s.reach}>
      {flow.method === 'ssh' ? (
        <>
          <HostField flow={flow} focus={!still} help="As you’d type it after ssh." />
          <Options flow={flow} />
        </>
      ) : (
        <CodeField flow={flow} focus={!still} />
      )}
      {flow.method === 'pair' && flow.found !== null && (
        <p className={s.read}>
          <Icon name="check" size={13} />
          <span>
            A home at <Code>{flow.found.target}</Code>
          </span>
        </p>
      )}
    </div>
  )
}

function Confirm({ flow }: { flow: Flow }) {
  if (flow.found === null) return <div className={s.confirm} />
  if (flow.stage === 'connected')
    return (
      <div className={s.done}>
        <span className={s.doneMark}>
          <Icon name="check" size={20} />
        </span>
        <strong>{flow.name}</strong>
        <span className={s.doneLine}>
          <LiveDot /> Open in a window of its own
        </span>
      </div>
    )
  return (
    <div className={s.confirm}>
      <div className={s.identity}>
        <span className={s.identityHead}>
          <span>Its identity</span>
          <CopyButton value={flow.found.homeId} ghost />
        </span>
        <Chunked homeId={flow.found.homeId} className={s.chunks} />
        <p className={s.identityNote}>
          {flow.method === 'ssh' ? (
            <>
              <Code>althar-host status</Code> on the host prints the same. Connect only if it does.
            </>
          ) : (
            'Tasks and conversations are available. Approvals need a trusted device.'
          )}
        </p>
      </div>
      <div className={s.naming}>
        <NameField flow={flow} focus />
        <span className={s.preview} aria-hidden="true">
          <span className={s.previewLabel}>In the bar</span>
          <span className={chip.chip}>
            <Icon name="home" size={14} />
            <span className={chip.chipName}>{flow.name.trim() === '' ? 'My server' : flow.name}</span>
          </span>
        </span>
      </div>
      <LaterProblem flow={flow} />
    </div>
  )
}
