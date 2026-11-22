import type { ReactNode } from 'react'

import { Brand, BrandMark, Button, HalftoneMark, Heading, Icon, type IconName, Light, LiveDot } from '@althar/ui'

import { open, Releases, WayIn, Words } from '../parts'
import { dated, FELT, FLAGSHIP, FLAGSHIP_WHY, type Highlight, HIGHLIGHTS, NOW } from '../notes'
import l from './launch.module.css'

/*
 * Look 1: Althar's light. The release opens as the window first did, on
 * the light the launch and the home at rest stand on (the kit's Light) and
 * the mark coming up in halftone, the flagship large over it with its two
 * ways in. Then where the work runs now, the three places in a row; the
 * rest of what's new as tiles, each with a small picture in the app's own
 * marks and type; what feels better; and every change, a fold away.
 */

/** The three places the work runs now, as the flagship has them. */
const PLACES: readonly { icon: IconName; name: string; code: boolean; role: string; holds: readonly string[]; live?: boolean }[] = [
  {
    icon: 'computer',
    name: 'This computer',
    code: false,
    role: 'The window',
    holds: ['Where you talk to tasks', 'Close it; the work goes on'],
  },
  { icon: 'home', name: 'build-01', code: true, role: 'Your home', holds: ['Projects and their tasks', 'Each agent’s asks and tools'] },
  { icon: 'terminal', name: 'runner-1', code: true, role: 'A worker', holds: ['A task’s lead', 'Its setup and Run'], live: true },
]

/** Each tile's picture: the feature in the app's own marks and type. */
function TileArt({ name }: { name: string }) {
  if (name === 'Computer use')
    return (
      <div className={l.artAsk} aria-hidden="true">
        <span className={l.askIcon}>
          <Icon name="viewport" size={15} />
        </span>
        <span className={l.askWords}>
          <b>Use Simulator and Safari?</b>
          <span>This turn</span>
        </span>
        <span className={l.askWays}>
          <Button size="small" variant="quiet" tabIndex={-1}>
            Deny
          </Button>
          <Button size="small" variant="signal" tabIndex={-1}>
            Allow once
          </Button>
        </span>
      </div>
    )
  if (name === 'Artifacts you talk to')
    return (
      <div className={l.artBoard} aria-hidden="true">
        <div className={l.board}>
          <i className={l.boardHead} />
          <i className={l.boardLine} />
          <i className={l.boardPrice} />
          <span className={l.pin}>1</span>
        </div>
        <div className={l.said}>
          <span className={l.saidPin}>1</span>
          <span>Bigger price, less copy</span>
        </div>
        <Icon name="arrow" size={14} className={l.into} />
        <code className={l.next}>v3</code>
      </div>
    )
  if (name === 'Goals')
    return (
      <div className={l.artGoal} aria-hidden="true">
        <span className={l.slash}>/goal</span> ship the pricing page
      </div>
    )
  if (name === 'More agents')
    return (
      <div className={l.artMarks} aria-hidden="true">
        {[Brand.ClaudeCode, Brand.Codex, Brand.OpenCode, Brand.GeminiCli, Brand.Cursor, Brand.GitHubCopilot].map((brand) => (
          <span key={brand} className={l.markChip}>
            <BrandMark brand={brand} size={16} />
          </span>
        ))}
        <span className={l.markChip}>
          <Icon name="plus" size={14} />
        </span>
      </div>
    )
  if (name === 'Terminals in Althar')
    return (
      <pre className={l.artTerm} aria-hidden="true">
        <span className={l.prompt}>$</span> bun run dev{'\n'}
        <span className={l.dim}> ready on</span> localhost:5173{'\n'}
        <span className={l.prompt}>$</span> <span className={l.caret} />
      </pre>
    )
  if (name === 'Bring in your work')
    return (
      <div className={l.artFrom} aria-hidden="true">
        {[Brand.Conductor, Brand.Orca, Brand.Paradev, Brand.Cursor, Brand.Codex].map((brand) => (
          <BrandMark key={brand} brand={brand} size={18} />
        ))}
        <Icon name="arrow" size={14} className={l.into} />
        <span className={l.intoTask}>Tasks</span>
      </div>
    )
  return null
}

function Tile({ one, size }: { one: Highlight; size: 'big' | 'small' | 'wide' }) {
  const big = size === 'big'
  return (
    <li className={`${l.tile} ${size === 'small' ? '' : l[size]}`}>
      <span className={l.tileIcon}>
        <Icon name={one.icon} size={big ? 20 : 17} />
      </span>
      <Heading level={3} className={l.tileName}>
        {one.name}
      </Heading>
      <p className={l.tileLine}>
        <Words text={big ? one.whole : one.line} />
      </p>
      <TileArt name={one.name} />
      <WayIn way={one.way} className={l.way} />
    </li>
  )
}

export function Launch({ back }: { back?: ReactNode }) {
  return (
    <div className={l.page}>
      <header className={l.hero}>
        <div className={l.glow}>
          <Light height={0.56} motion="drift" />
        </div>
        {back !== undefined && <div className={l.back}>{back}</div>}
        <div className={l.heroIn}>
          <HalftoneMark size={58} />
          <p className={l.eyebrow}>
            <span className={l.version}>Althar {NOW.version}</span>
            <span>{dated(NOW.date)}</span>
          </p>
          <Heading level={1} className={l.title}>
            {FLAGSHIP.title}
          </Heading>
          <p className={l.why}>{FLAGSHIP_WHY}</p>
          <div className={l.actions}>
            <Button variant="ink" icon="home" onClick={() => open('homes')}>
              Connect a home
            </Button>
            <Button icon="plus" onClick={() => open('workers')}>
              Add a worker
            </Button>
          </div>
        </div>
      </header>

      <section className={l.band} aria-labelledby="where">
        <Heading level={2} id="where" className={l.kicker}>
          Where the work runs now
        </Heading>
        <ol className={l.places}>
          {PLACES.map((place, i) => (
            <li key={place.name} className={l.placeCell}>
              {i > 0 && (
                <span className={l.link} aria-hidden="true">
                  <i />
                </span>
              )}
              <div className={l.place}>
                <span className={l.placeIcon}>
                  <Icon name={place.icon} size={18} />
                </span>
                <span className={l.placeRole}>{place.role}</span>
                {place.code ? <code className={l.placeCode}>{place.name}</code> : <span className={l.placeName}>{place.name}</span>}
                <ul className={l.holds}>
                  {place.holds.map((what) => (
                    <li key={what}>
                      {place.live === true && what === place.holds[0] ? <LiveDot pulse /> : <Icon name="check" size={12} />}
                      {what}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className={l.band} aria-labelledby="also">
        <Heading level={2} id="also" className={l.sectionTitle}>
          Also in {NOW.version}
        </Heading>
        <ul className={l.tiles}>
          {HIGHLIGHTS.map((one, i) => (
            <Tile key={one.name} one={one} size={i < 2 ? 'big' : i === HIGHLIGHTS.length - 1 ? 'wide' : 'small'} />
          ))}
        </ul>
      </section>

      <section className={l.band} aria-labelledby="felt">
        <Heading level={2} id="felt" className={l.sectionTitle}>
          Better everywhere
        </Heading>
        <ul className={l.felt}>
          {FELT.map((one) => (
            <li key={one.name}>
              <b>{one.name}</b>
              <span>{one.line}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className={l.foot}>
        <Releases />
      </div>
    </div>
  )
}
