import type { ReactNode } from 'react'

import { Brand } from '../../foundations/brands/brands'
import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { Icon } from '../../foundations/Icon/Icon'
import type { IconName } from '../../foundations/Icon/icons'
import { Light } from '../../foundations/Light/Light'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { safeHref } from '../../lib/safeHref'
import { Heading } from '../../primitives/Heading/Heading'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { FeatureArt, type FeatureArtKey } from './FeatureArt'
import { dated, type ReleaseNotes } from './notes'
import { Releases, type ReleasesText, Words } from './Releases'
import l from './WhatsNew.module.css'

/*
 * What's new, after an update: the release on Althar's own light, the one
 * the launch and the home at rest stand on, with the mark coming up in
 * halftone, the version the person came from, and the release's lead large
 * over it; no buttons. Then the lead drawn, where it has a picture; the rest
 * of what's new as tiles, each with its small picture where it has one; what
 * feels better; where to follow what's next, on the light again; and every
 * release, a fold away.
 */

/** A new feature, on its tile. */
export interface WhatsNewFeature {
  name: string
  /** What it is, in a line. */
  line: string
  /** All its line in the notes says, past its name: the large tiles show it. */
  whole: string
  icon?: IconName
  art?: FeatureArtKey
  /** Where it's set up or tried in the app. */
  way?: { label: string; onPress: () => void }
}

/** The release's lead: what it's about, why it matters, and its picture where it has one. */
export interface WhatsNewLead {
  title: string
  why: string
  /** The lead drawn, under a title of its own: where the work runs now. */
  picture?: { title: string; drawing: ReactNode }
}

export type FollowKind = 'github' | 'discord' | 'x' | 'linkedin'

/** Where Althar is followed: its address, and the name it goes by there. */
export interface FollowLink {
  kind: FollowKind
  href: string
  handle: string
}

export interface WhatsNewText {
  /** The jump this update made, for whoever can't see the arrow. */
  jump: (from: string, to: string) => string
  also: (version: string) => string
  better: string
  follow: string
  followLine: string
  follows: Record<FollowKind, string>
  coming: string
  releases?: Partial<ReleasesText>
}

export const whatsNewText: WhatsNewText = {
  jump: (from, to) => `Updated from ${from} to ${to}`,
  also: (version) => `Also in ${version}`,
  better: 'Better everywhere',
  follow: 'Follow what’s next',
  followLine: 'Althar is built in the open. New releases, and what’s coming, as they land.',
  follows: { github: 'Star it on GitHub', discord: 'Join the Discord', x: 'Follow on X', linkedin: 'Follow on LinkedIn' },
  coming: 'See what’s coming next',
}

export type WhatsNewProps = RootProps<
  'div',
  {
    /** The release this is. */
    release: ReleaseNotes
    /** The version the person updated from, where they updated. */
    from?: string
    lead: WhatsNewLead
    /** The rest of what's new, the first two drawn large. */
    features: readonly WhatsNewFeature[]
    /** What feels better, a line each: the first few. */
    better: readonly string[]
    follow: readonly FollowLink[]
    /** Every release, newest first, for the foot. */
    releases: readonly ReleaseNotes[]
    /** The changelog on the site, for the releases not listed, from this one back. */
    more?: { href: string; from: string }
    /** To Coming next. */
    onComing?: () => void
    text?: Partial<WhatsNewText>
  }
>

/** X's, LinkedIn's and Discord's marks (Simple Icons, CC0), drawn as the kit draws a brand's: in the ink around them. */
const SOCIAL = {
  x: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  linkedin:
    'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.831 1.637-1.71 3.37-1.71 3.601 0 4.267 2.37 4.267 4.99v6.272ZM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z',
  discord:
    'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z',
} as const

function FollowMark({ kind }: { kind: FollowKind }) {
  if (kind === 'github') return <BrandMark brand={Brand.GitHub} size={18} />
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden="true" focusable="false">
      <path d={SOCIAL[kind]} />
    </svg>
  )
}

/** A tile's size: the first two large; then rows of three, the last row's one or two widened to fill it. */
const sizeOf = (i: number, n: number): 'big' | 'small' | 'wide' => {
  if (i < 2) return 'big'
  const rest = n - 2
  const k = i - 2
  if (rest % 3 === 1 && k === rest - 1) return 'wide'
  if (rest % 3 === 2 && k >= rest - 2) return 'big'
  return 'small'
}

function Tile({ one, size }: { one: WhatsNewFeature; size: 'big' | 'small' | 'wide' }) {
  const big = size === 'big'
  return (
    <li className={cx(l.tile, size !== 'small' && l[size])}>
      {one.icon !== undefined && (
        <span className={l.tileIcon}>
          <Icon name={one.icon} size={big ? 20 : 17} />
        </span>
      )}
      <Heading level={3} className={l.tileName}>
        {one.name}
      </Heading>
      <p className={l.tileLine}>
        <Words text={big ? one.whole : one.line} />
      </p>
      {one.art !== undefined && <FeatureArt of={one.art} />}
      {one.way !== undefined && (
        <LinkButton className={l.way} onClick={one.way.onPress}>
          {one.way.label}
        </LinkButton>
      )}
    </li>
  )
}

export function WhatsNew({
  release,
  from,
  lead,
  features,
  better,
  follow,
  releases,
  more,
  onComing,
  text,
  className,
  ...rest
}: WhatsNewProps) {
  const t = { ...whatsNewText, ...text }
  const [first, ...others] = lead.title.split(', ')
  return (
    <div className={cx(l.page, className)} {...rest}>
      <header className={l.hero}>
        <div className={l.glow}>
          <Light height={0.8} motion="drift" />
        </div>
        <div className={l.heroIn}>
          <HalftoneMark size={58} />
          <p className={l.eyebrow}>
            <span className={l.jump} {...(from === undefined ? {} : { 'aria-label': t.jump(from, release.version) })}>
              {from !== undefined && (
                <>
                  <span className={l.from} aria-hidden="true">
                    {from}
                  </span>
                  <Icon name="arrow" size={12} />
                </>
              )}
              <span className={l.version} {...(from === undefined ? {} : { 'aria-hidden': true })}>
                {release.version}
              </span>
            </span>
            <span>{dated(release.date)}</span>
          </p>
          <Heading level={1} className={l.title}>
            {others.length > 0 ? (
              <>
                {`${first}, `}
                <span className={l.titleLit}>{others.join(', ')}</span>
              </>
            ) : (
              lead.title
            )}
          </Heading>
          <p className={l.why}>{lead.why}</p>
        </div>
      </header>

      {lead.picture !== undefined && (
        <section className={cx(l.band, l.where)} aria-labelledby="whats-new-lead">
          <Heading level={2} id="whats-new-lead" className={l.kicker}>
            {lead.picture.title}
          </Heading>
          {lead.picture.drawing}
        </section>
      )}

      {features.length > 0 && (
        <section className={l.band} aria-labelledby="whats-new-also">
          <Heading level={2} id="whats-new-also" className={l.sectionTitle}>
            {t.also(release.version)}
          </Heading>
          <ul className={l.tiles}>
            {features.map((one, i) => (
              <Tile key={one.name} one={one} size={sizeOf(i, features.length)} />
            ))}
          </ul>
        </section>
      )}

      {better.length > 0 && (
        <section className={l.band} aria-labelledby="whats-new-better">
          <Heading level={2} id="whats-new-better" className={l.sectionTitle}>
            {t.better}
          </Heading>
          <ul className={l.felt}>
            {better.map((line) => (
              <li key={line}>
                <span>
                  <Words text={line} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={l.follow} aria-labelledby="whats-new-follow">
        <div className={l.followGlow}>
          <Light height={0.8} motion="drift" />
        </div>
        <div className={l.followIn}>
          <Heading level={2} id="whats-new-follow" className={l.followTitle}>
            {t.follow}
          </Heading>
          <p className={l.followLine}>{t.followLine}</p>
          <ul className={l.socials}>
            {follow.map((one) => {
              const href = safeHref(one.href)
              if (href === undefined) return null
              return (
                <li key={one.kind}>
                  <a className={l.social} href={href} target="_blank" rel="noreferrer">
                    <span className={l.socialMark}>
                      <FollowMark kind={one.kind} />
                    </span>
                    <span className={l.socialWords}>
                      <b>{t.follows[one.kind]}</b>
                      <span>{one.handle}</span>
                    </span>
                    <Icon name="external" size={12} className={l.socialOut} />
                  </a>
                </li>
              )
            })}
          </ul>
          {onComing !== undefined && (
            <LinkButton className={l.coming} onClick={onComing}>
              {t.coming}
            </LinkButton>
          )}
        </div>
      </section>

      <div className={l.foot}>
        <Releases
          releases={releases}
          {...(from === undefined ? {} : { from })}
          {...(more === undefined ? {} : { more: more.href, moreFrom: more.from })}
          {...(t.releases === undefined ? {} : { text: t.releases })}
        />
      </div>
    </div>
  )
}
