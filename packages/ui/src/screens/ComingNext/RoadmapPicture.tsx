import type { CSSProperties, ReactNode } from 'react'

import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { Logo } from '../../foundations/Logo/Logo'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import p from './RoadmapPicture.module.css'

/** The things on the roadmap the kit draws. */
export type RoadmapPictureKey = 'installer' | 'trigger' | 'phone' | 'simulator' | 'knowledge' | 'team'

/** Windows' mark, in the ink around it. */
const WindowsMark = () => (
  <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden="true">
    <path fill="currentColor" d="M3 3h8.5v8.5H3zM12.5 3H21v8.5h-8.5zM3 12.5h8.5V21H3zM12.5 12.5H21V21h-8.5z" />
  </svg>
)

/*
 * Each coming thing, drawn as it will work, in the app's own marks and type:
 * a short loop that shows what changes (the installer's publisher, an event
 * starting a task, an ask answered from a phone, a lead trying the app it
 * changed, a project's notes, a team on one project). Decoration to
 * assistive technology: the card's words say it. With motion reduced, each
 * stands on how it ends.
 */

/** Windows signing: the installer, its publisher unknown, then Althar's, verified. */
function Installer() {
  return (
    <div className={p.installer}>
      <div className={p.dialog}>
        <div className={p.dialogBar}>
          <WindowsMark />
          <span>Althar Setup</span>
        </div>
        <div className={p.dialogBody}>
          <Logo size={30} />
          <span className={p.dialogWords}>
            <b>Install Althar</b>
            <span>For everyone on this computer</span>
          </span>
        </div>
        <div className={p.publisher}>
          <span className={p.pubLabel}>Publisher</span>
          <span className={p.pubStates}>
            <span className={p.unknown}>
              <Icon name="problem" size={12} />
              Unknown publisher
            </span>
            <span className={p.verified}>
              <Icon name="lock" size={12} />
              Althar, verified
            </span>
          </span>
        </div>
        <div className={p.dialogFoot}>
          <Button size="small" variant="quiet" tabIndex={-1}>
            Cancel
          </Button>
          <Button size="small" variant="ink" tabIndex={-1}>
            Install
          </Button>
        </div>
        <span className={p.seal}>
          <Icon name="check" size={14} />
        </span>
      </div>
    </div>
  )
}

/** Event-based automations: main goes red, the automation's rule takes it, a fix starts. */
function Trigger() {
  return (
    <div className={p.trigger}>
      <div className={`${p.node} ${p.event}`}>
        <span className={p.nodeMark}>
          <BrandMark brand={Brand.GitHub} size={14} />
        </span>
        <span className={p.nodeWords}>
          <b>Check failed on main</b>
          <code>meridian-api · test</code>
        </span>
      </div>
      <span className={`${p.wire} ${p.wireA}`}>
        <i />
      </span>
      <div className={`${p.node} ${p.rule}`}>
        <span className={`${p.nodeMark} ${p.ruleMark}`}>
          <Icon name="automation" size={14} />
        </span>
        <span className={p.nodeWords}>
          <b>Fix main when it goes red</b>
          <span>When a check fails on main</span>
        </span>
      </div>
      <span className={`${p.wire} ${p.wireB}`}>
        <i />
      </span>
      <div className={`${p.node} ${p.started}`}>
        <span className={p.nodeMark}>
          <BrandMark brand={Brand.ClaudeCode} size={14} />
        </span>
        <span className={p.nodeWords}>
          <b>Fix the failing test</b>
          <span className={p.running}>
            <LiveDot pulse />
            Running
          </span>
        </span>
      </div>
    </div>
  )
}

/** The mobile app: a task's ask comes to the phone, and is allowed there. */
function Phone() {
  return (
    <div className={p.phoneScene}>
      <div className={p.phone}>
        <div className={p.phoneTop}>
          <span>14:02</span>
          <span className={p.island} />
          <span className={p.bars} />
        </div>
        <div className={p.notice}>
          <div className={p.noticeHead}>
            <span className={p.appIcon}>
              <Logo size={11} />
            </span>
            <span>Althar</span>
            <span className={p.noticeWhen}>now</span>
          </div>
          <b>Partial refunds asks</b>
          <span className={p.noticeWhat}>
            Run <code>bun test src/refunds</code>?
          </span>
          <div className={p.noticeWays}>
            <Button size="small" variant="quiet" tabIndex={-1}>
              Deny
            </Button>
            <span className={p.press}>
              <Button size="small" variant="signal" tabIndex={-1}>
                Allow
              </Button>
            </span>
          </div>
        </div>
        <div className={p.allowed}>
          <LiveDot pulse />
          <span>
            <b>Allowed</b> · tests running on build-01
          </span>
        </div>
        <span className={p.homeBar} />
      </div>
    </div>
  )
}

/** Integrated simulators: the lead taps through the app it changed, and brings back what it saw. */
function Simulator() {
  return (
    <div className={p.sim}>
      <div className={p.thread}>
        <div className={p.said}>
          <span className={p.saidMark}>
            <BrandMark brand={Brand.ClaudeCode} size={12} />
          </span>
          <span>Tried checkout on the simulator.</span>
        </div>
        <div className={p.shot}>
          <span className={p.shotScreen}>
            <Icon name="check" size={12} />
          </span>
          <span className={p.shotWords}>
            <b>Paid</b>
            <span>Screenshot · step 3</span>
          </span>
        </div>
        <div className={p.said2}>Paid in two taps; nothing broke.</div>
      </div>
      <div className={p.device}>
        <span className={p.deviceIsland} />
        <div className={p.screen}>
          <div className={p.cart}>
            <span className={p.cartTitle}>Your cart</span>
            <span className={p.cartLine}>
              <i />
              <span>€24.00</span>
            </span>
            <span className={p.cartLine}>
              <i />
              <span>€18.00</span>
            </span>
            <span className={p.cartTotal}>
              <span>Total</span>
              <b>€42.00</b>
            </span>
            <span className={p.pay}>
              Pay
              <span className={p.tap} />
            </span>
          </div>
          <div className={p.paid}>
            <span className={p.paidMark}>
              <Icon name="check" size={16} />
            </span>
            <b>Paid</b>
            <span>€42.00</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const NOTES = [
  { what: 'Refunds go through the queue', from: 'PR #1184’s review', icon: 'pr' },
  { what: 'Use bun, never npm', from: 'CONTRIBUTING.md', icon: 'file' },
  { what: 'Tokens refresh every 5 minutes', from: 'Task 418', icon: 'session' },
] as const

/** Its place in a run that comes in one after another. */
const nth = (i: number) => ({ '--i': i }) as CSSProperties

/** The project knowledge store: what the project learned, each with its source, and every agent starting from it. */
function Knowledge() {
  return (
    <div className={p.know}>
      <ul className={p.notes}>
        {NOTES.map((note, i) => (
          <li key={note.what} style={nth(i)}>
            <b>{note.what}</b>
            <span className={p.from}>
              <Icon name={note.icon} size={11} />
              {note.from}
            </span>
          </li>
        ))}
      </ul>
      <div className={p.readers}>
        {[Brand.ClaudeCode, Brand.Codex, Brand.GeminiCli].map((brand, i) => (
          <span key={brand} className={p.reader} style={nth(i)}>
            <BrandMark brand={brand} size={14} />
          </span>
        ))}
      </div>
    </div>
  )
}

const PEOPLE = ['AK', 'MR', 'JS'] as const

/** Teams, in the cloud: a project shared, its people and a hosted agent at work on it. */
function Team() {
  return (
    <div className={p.team}>
      <div className={p.teamHead}>
        <span className={p.projMark}>m</span>
        <b>meridian</b>
        <span className={p.people}>
          {PEOPLE.map((who, i) => (
            <span key={who} className={p.face} style={nth(i)}>
              {who}
            </span>
          ))}
          <span className={`${p.face} ${p.hosted}`} style={nth(PEOPLE.length)}>
            <BrandMark brand={Brand.ClaudeCode} size={11} />
          </span>
        </span>
      </div>
      <ul className={p.teamTasks}>
        <li style={nth(0)}>
          <span className={p.owner}>AK</span>
          <span className={p.teamTask}>Partial refunds</span>
          <LiveDot />
        </li>
        <li style={nth(1)}>
          <span className={p.owner}>MR</span>
          <span className={p.teamTask}>Webhook retries</span>
          <span className={p.teamState}>Review</span>
        </li>
        <li style={nth(2)}>
          <span className={`${p.owner} ${p.hosted}`}>
            <BrandMark brand={Brand.ClaudeCode} size={10} />
          </span>
          <span className={p.teamTask}>Payout export</span>
          <span className={p.teamState}>
            <Icon name="globe" size={11} />
            Hosted
          </span>
        </li>
      </ul>
    </div>
  )
}

const DRAWN: Record<RoadmapPictureKey, () => ReactNode> = {
  installer: Installer,
  trigger: Trigger,
  phone: Phone,
  simulator: Simulator,
  knowledge: Knowledge,
  team: Team,
}

/** A coming thing's picture, filling the frame it's given. */
export function RoadmapPicture({ picture, className }: { picture: RoadmapPictureKey; className?: string }) {
  const Drawn = DRAWN[picture]
  return (
    <div className={cx(p.frame, className)} data-picture={picture} aria-hidden="true">
      <Drawn />
    </div>
  )
}
