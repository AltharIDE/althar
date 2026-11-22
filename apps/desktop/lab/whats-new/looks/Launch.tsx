import type { ReactNode } from 'react'

import { Brand, BrandMark, Button, HalftoneMark, Heading, Icon, type IconName, Light, LiveDot } from '@althar/ui'

import { LINKS } from '../../../../site/src/content/facts'
import { Releases, WayIn, Words } from '../parts'
import { dated, FELT, FLAGSHIP, FLAGSHIP_WHY, fromVersion, type Highlight, HIGHLIGHTS, NOW } from '../notes'
import { useLab } from '../state'
import l from './launch.module.css'

/*
 * Look 1: Althar's light. The release opens as the window first did, on
 * the light the launch and the home at rest stand on (the kit's Light) and
 * the mark coming up in halftone, the flagship large over it. Then where
 * the work runs now, the three places in a row with the work going along
 * them; the rest of what's new as tiles, each with a small picture in the
 * app's own marks and type; what feels better; where to follow what's
 * next, on the light again; and every change, a fold away.
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

/** X's and LinkedIn's marks, drawn as the kit draws a brand's: in the ink around them (Simple Icons). */
function SocialMark({ of }: { of: 'x' | 'linkedin' }) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true" focusable="false">
      <path
        d={
          of === 'x'
            ? 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z'
            : 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.831 1.637-1.71 3.37-1.71 3.601 0 4.267 2.37 4.267 4.99v6.272ZM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z'
        }
      />
    </svg>
  )
}

/** Where to follow what's next. X's and LinkedIn's addresses stand in: the repository doesn't keep the real ones. */
const FOLLOW: readonly { key: string; mark: ReactNode; what: string; where: string; href: string }[] = [
  {
    key: 'github',
    mark: <BrandMark brand={Brand.GitHub} size={18} />,
    what: 'Star it on GitHub',
    where: 'AltharIDE/althar',
    href: LINKS.repo,
  },
  { key: 'x', mark: <SocialMark of="x" />, what: 'Follow on X', where: '@altharai', href: 'https://x.com/altharai' },
  {
    key: 'linkedin',
    mark: <SocialMark of="linkedin" />,
    what: 'Follow on LinkedIn',
    where: 'Althar',
    href: 'https://www.linkedin.com/company/althar',
  },
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
        <code className={l.next}>
          <span className={l.was}>v2</span>
          <span className={l.now}>v3</span>
        </code>
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
  const { skipped } = useLab()
  const [first, ...rest] = FLAGSHIP.title.split(', ')
  return (
    <div className={l.page}>
      <header className={l.hero}>
        <div className={l.glow}>
          <Light height={0.8} motion="drift" />
        </div>
        {back !== undefined && <div className={l.back}>{back}</div>}
        <div className={l.heroIn}>
          <HalftoneMark size={58} />
          <p className={l.eyebrow}>
            <span className={l.jump}>
              <span className={l.from}>{fromVersion(skipped)}</span>
              <Icon name="arrow" size={12} />
              <span className={l.version}>{NOW.version}</span>
            </span>
            <span>{dated(NOW.date)}</span>
          </p>
          <Heading level={1} className={l.title}>
            {rest.length > 0 ? (
              <>
                {first},<span className={l.titleLit}> {rest.join(', ')}</span>
              </>
            ) : (
              FLAGSHIP.title
            )}
          </Heading>
          <p className={l.why}>{FLAGSHIP_WHY}</p>
        </div>
      </header>

      <section className={`${l.band} ${l.where}`} aria-labelledby="where">
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

      <section className={l.follow} aria-labelledby="follow">
        <div className={l.followGlow}>
          <Light height={0.8} motion="drift" />
        </div>
        <div className={l.followIn}>
          <Heading level={2} id="follow" className={l.followTitle}>
            Follow what’s next
          </Heading>
          <p className={l.followLine}>Althar is built in the open. New releases, and what’s coming, as they land.</p>
          <ul className={l.socials}>
            {FOLLOW.map((one) => (
              <li key={one.key}>
                <a className={l.social} href={one.href} target="_blank" rel="noreferrer">
                  <span className={l.socialMark}>{one.mark}</span>
                  <span className={l.socialWords}>
                    <b>{one.what}</b>
                    <span>{one.where}</span>
                  </span>
                  <Icon name="external" size={12} className={l.socialOut} />
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className={l.foot}>
        <Releases />
      </div>
    </div>
  )
}
