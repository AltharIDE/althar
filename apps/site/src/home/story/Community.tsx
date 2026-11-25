import { Logo } from '@althar/ui'
import { useRef } from 'react'

import { LINKS } from '../../content/facts'
import { cx } from '../../lib/cx'
import { DiscordMark } from '../../shared/Bar'
import { useMarks } from '../bodies/kit/loop'
import { useGlide } from '../bodies/kit/talk'
import { KM } from './Altitude'
import s from './Community.module.css'
import { COMMUNITY, SCENE } from './scenes'
import { useScrolled } from './scroll'
import st from './Story.module.css'

/*
 * The community: Althar's Discord, drawn as a server is, on the page's warm
 * dark. Down the left the servers (Althar's mark the one open), then the
 * channels with #general open; in it Niko and Balazs, who build Althar,
 * answer the people asking how it works and what comes next, a message at a
 * time, someone always typing the next. The words beside it say so, and
 * the way in is a button to join.
 *
 * The people asking are invented, as the demo projects are; what they're
 * told is true of Althar today (scenes.tsx COMMUNITY). Nothing in it can be
 * pressed; it reads as its label.
 */

/** When each message lands, in ms into the story: the first two are there as it comes in, then one every `EVERY`. */
const EVERY = 2300
const FIRST = 2
const AT = COMMUNITY.chat.map((_, i) => (i < FIRST ? 0 : (i - FIRST + 1) * EVERY))
/** How long before each lands its writer is typing. */
const TYPING = 1300
const LENGTH = AT.at(-1)! + 3200
/** Held still: the whole conversation. */
const STILL = LENGTH
const MARKS = [...AT, ...AT.map((at) => Math.max(0, at - TYPING))]

const initials = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

function Hash() {
  return (
    <svg className={s.hash} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3 7 21M17 3l-2 18M4 8.5h17M3 15.5h17" />
    </svg>
  )
}

function Speaker() {
  return (
    <svg className={s.hash} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  )
}

function Server() {
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [ms] = useMarks(box, LENGTH, STILL, MARKS)
  useGlide(list)
  const shown = AT.filter((at) => ms >= at).length
  const next = COMMUNITY.chat[shown]
  const typing = next && ms >= AT[shown]! - TYPING ? next.who : null
  return (
    <div ref={box} className={s.window} role="img" aria-label={COMMUNITY.label}>
      <nav className={s.rail} aria-hidden="true">
        <span className={cx(s.server, s.open)}>
          <Logo size={22} />
        </span>
        <span className={s.split} />
        <span className={cx(s.server, s.add)}>+</span>
      </nav>
      <aside className={s.channels} aria-hidden="true">
        <header className={s.serverName}>
          <b>Althar</b>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" />
          </svg>
        </header>
        {COMMUNITY.channels.map((group) => (
          <div key={group.name} className={s.group}>
            <span className={s.groupName}>{group.name}</span>
            {group.items.map((c) => (
              <span key={c.name} className={cx(s.channel, c.open && s.here, c.unread && s.unread)}>
                {c.voice ? <Speaker /> : <Hash />}
                {c.name}
                {c.unread && <i className={s.badge} />}
              </span>
            ))}
          </div>
        ))}
      </aside>
      <div className={s.main}>
        <header className={s.top}>
          <Hash />
          <b>general</b>
          <span className={s.topic}>{COMMUNITY.topic}</span>
        </header>
        <div className={s.room} data-fade="">
          <div ref={list} className={s.list}>
            {COMMUNITY.chat.slice(0, shown).map((m, i) => {
              const team = COMMUNITY.team.includes(m.who)
              return (
                <article key={i} className={cx(s.message, i >= FIRST && s.lands)}>
                  <span className={cx(s.avatar, team && s.teamAvatar)} style={{ background: team ? undefined : m.hue }}>
                    {team ? <Logo size={16} /> : initials(m.who)}
                  </span>
                  <div className={s.body}>
                    <p className={s.byline}>
                      <b className={cx(team && s.teamName)}>{m.who}</b>
                      {team && <span className={s.tag}>Team</span>}
                      <time>{m.at}</time>
                    </p>
                    <p className={s.text}>{m.text}</p>
                    {m.reactions && (
                      <p className={s.reactions}>
                        {m.reactions.map(([emoji, n]) => (
                          <span key={emoji}>
                            {emoji} <b>{n}</b>
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </div>
        <footer className={s.foot}>
          <span className={s.composer}>
            <i>+</i>
            Message #general
          </span>
          <span className={s.typing} data-on={typing ? '' : undefined}>
            <span className={s.dots}>
              <i />
              <i />
              <i />
            </span>
            <b>{typing ?? ''}</b> is typing…
          </span>
        </footer>
      </div>
    </div>
  )
}

export function Community() {
  const box = useRef<HTMLElement>(null)
  useScrolled(box, { enter: true })
  return (
    <section ref={box} id="community" className={cx(st.scene, s.community)} aria-labelledby="community-h" data-km={KM.community}>
      <div className={cx(st.wrap, s.grid)}>
        <div className={s.words}>
          <h2 id="community-h" className={cx(st.title, st.quiet)}>
            {SCENE.community.title}
          </h2>
          <p className={st.lead}>{SCENE.community.lead}</p>
          <a className={s.join} href={LINKS.discord}>
            <DiscordMark size={20} />
            Join on Discord
          </a>
        </div>
        <div className={s.shot}>
          <Server />
        </div>
      </div>
    </section>
  )
}
