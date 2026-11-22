import type { ReactNode } from 'react'

import { Brand, BrandMark, Button, HalftoneMark, Heading, Icon, Light, LinkButton } from '@althar/ui'

import { LINKS } from '../../../../site/src/content/facts'
import { COMMUNITY } from '../../../src/renderer/shared/links'
import { Releases, WayIn, Words } from '../parts'
import { dated, FELT, FLAGSHIP, FLAGSHIP_WHY, fromVersion, type Highlight, HIGHLIGHTS, NOW } from '../notes'
import { lab, useLab } from '../state'
import l from './launch.module.css'
import { Where } from './Where'

/*
 * Look 1: Althar's light. The release opens as the window first did, on
 * the light the launch and the home at rest stand on (the kit's Light) and
 * the mark coming up in halftone, the flagship large over it. Then where
 * the work runs now, as one picture of the machines with the work going
 * between them (Where.tsx); the rest of what's new as tiles, each with a small picture in the
 * app's own marks and type; what feels better; where to follow what's
 * next, on the light again; and every change, a fold away.
 */

/** Simple Icons' marks (CC0) for where Althar is followed, drawn as the kit draws a brand's: in the ink around them. */
const SOCIAL = {
  x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  linkedin:
    'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.831 1.637-1.71 3.37-1.71 3.601 0 4.267 2.37 4.267 4.99v6.272ZM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z',
  discord:
    'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z',
} as const

function SocialMark({ of }: { of: keyof typeof SOCIAL }) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true" focusable="false">
      <path d={SOCIAL[of]} />
    </svg>
  )
}

/** Where to follow what's next. */
const FOLLOW: readonly { key: string; mark: ReactNode; what: string; where: string; href: string }[] = [
  {
    key: 'github',
    mark: <BrandMark brand={Brand.GitHub} size={18} />,
    what: 'Star it on GitHub',
    where: 'AltharIDE/althar',
    href: LINKS.repo,
  },
  {
    key: 'discord',
    mark: <SocialMark of="discord" />,
    what: 'Join the Discord',
    where: 'Althar’s server',
    href: COMMUNITY,
  },
  { key: 'x', mark: <SocialMark of="x" />, what: 'Follow on X', where: '@AltharAiUS', href: 'https://x.com/AltharAiUS' },
  {
    key: 'linkedin',
    mark: <SocialMark of="linkedin" />,
    what: 'Follow on LinkedIn',
    where: 'althar-ai',
    href: 'https://www.linkedin.com/company/althar-ai/',
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
        <Where />
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
          <LinkButton className={l.coming} onClick={() => lab.set({ view: 'coming' })}>
            See what’s coming next
          </LinkButton>
        </div>
      </section>

      <div className={l.foot}>
        <Releases />
      </div>
    </div>
  )
}
