// Scrappy: what a page shows where there is no page: a new tab, a sign-in sent to the person's browser,
// a page the prototype doesn't have, a run that isn't running.
import { Icon } from '../../../src/foundations/Icon/Icon'
import { Button } from '../../../src/primitives/Button/Button'
import { LiveDot } from '../../../src/primitives/LiveDot/LiveDot'
import { shown, type Verdict } from '../addresses'
import { proto, RUNS, SIDE, TASK } from '../state'
import s from './Stand.module.css'

/** A new tab: what runs in althar now, a press away. */
export function Blank({ scope }: { scope: string }) {
  const runs = [
    { name: 'Site', where: 'main', address: RUNS.main.address },
    { name: 'Site', where: TASK.title, address: RUNS.task.address },
  ]
  return (
    <div className={s.stand}>
      <div className={s.box}>
        <h2 className={s.head}>Running in althar</h2>
        <ul className={s.runs}>
          {runs.map((run) => (
            <li key={run.address}>
              <button type="button" className={s.run} onClick={() => proto.navigate(scope, run.address)}>
                <LiveDot />
                <span className={s.runName}>
                  {run.name} <span className={s.where}>· {run.where}</span>
                </span>
                <code>{shown(run.address)}</code>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** A sign-in: sent to the person's browser, where their accounts are. */
export function SignIn({ verdict, scope, first }: { verdict: Extract<Verdict, { kind: 'signin' }>; scope: string; first: boolean }) {
  return (
    <div className={s.stand}>
      <div className={s.box}>
        <Icon name="external" size={18} className={s.mark} />
        <h2 className={s.head}>Opened in your browser</h2>
        <p className={s.why}>{verdict.host} asks you to sign in, and signing in happens in your own browser.</p>
        <div className={s.actions}>
          {first ? (
            <Button size="small" onClick={() => proto.closePage(scope)}>
              {scope.startsWith(SIDE) ? 'Close' : 'Close the tab'}
            </Button>
          ) : (
            <Button size="small" onClick={() => proto.back(scope)}>
              Back
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** A page of the web this prototype doesn't serve: in the app it loads like any other. */
export function Absent({ verdict }: { verdict: Extract<Verdict, { kind: 'absent' }> }) {
  return (
    <div className={s.stand}>
      <div className={`${s.box} ${s.prototype}`}>
        <h2 className={s.head}>{verdict.host}</h2>
        <p className={s.why}>The prototype only serves the Althar site. In the app this page loads here like any other.</p>
      </div>
    </div>
  )
}

/** B and C: the task's run isn't running; one press runs it in the task's folder. */
export function NotRunning({ starting }: { starting: boolean }) {
  return (
    <div className={s.stand}>
      <div className={s.box}>
        <h2 className={s.head}>The task’s site shows here while it runs</h2>
        <p className={s.why}>
          <code>bun run site</code> in <code>runs-on-versions</code>
        </p>
        <div className={s.actions}>
          <Button icon="play" busy={starting} onClick={() => proto.run()}>
            Run Site
          </Button>
        </div>
      </div>
    </div>
  )
}
