import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import type { HeadingLevel } from '../../primitives/Heading/Heading'
import { Path } from '../../primitives/Path/Path'
import { SettingGroup } from '../Preferences/Preferences'
import s from './OwnSetup.module.css'

/*
 * Settings › Agents, under an agent's accounts: the parts of the person's own
 * setup that agent doesn't load, or loads without part of what they set (a
 * settings file, a hook, an agent, a command, a plugin, a config.toml), each
 * with why, in the agent's own words where it said. One broken file is one row. Nothing shows while everything loads: it
 * is there to act on, and the person changes their own file; Althar never
 * does, and tasks go on without the part. A skill's is on its own tile.
 */

export interface OwnSetupPartView {
  id: string
  /** What it is, as the person names it: review-agent.md, settings.json, hooks.PreToolUse[0], a plugin's name. */
  name: string
  /** The file, as the person names it: ~/.claude/agents/review-agent.md. */
  where: string
  /** Why, in a sentence. */
  why: string
}

export interface OwnSetupText {
  title: string
  note: string
}

export const ownSetupText: OwnSetupText = {
  title: 'Didn’t load as written',
  note: 'From your own setup. Tasks go on without these, or without what they set, until you change the files.',
}

export interface OwnSetupProps {
  parts: readonly OwnSetupPartView[]
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<OwnSetupText>
}

/** What of the person's own setup an agent doesn't load, a row each, with why; nothing while everything does. */
export function OwnSetup({ parts, headingLevel = 3, className, text }: OwnSetupProps) {
  const t = { ...ownSetupText, ...text }
  if (parts.length === 0) return null
  return (
    <SettingGroup title={t.title} note={t.note} headingLevel={headingLevel} className={cx(s.group, className)}>
      <ul className={s.list}>
        {parts.map((part) => {
          // A file is named by where it is; a part of one (a hook, a plugin) by itself, then its file.
          const isFile = part.where.endsWith(`/${part.name}`)
          return (
            <li key={part.id} className={s.row}>
              <Icon name="problem" size={13} className={s.mark} />
              <span className={s.head}>
                {isFile ? (
                  <code className={s.path}>
                    <Path path={part.where} dirClassName={s.dir} nameClassName={s.name} />
                  </code>
                ) : (
                  <>
                    <code className={cx(s.name, s.own)}>{part.name}</code>
                    <code className={s.path}>
                      <Path path={part.where} dirClassName={s.dir} nameClassName={s.dir} />
                    </code>
                  </>
                )}
              </span>
              <span className={s.why}>{part.why}</span>
            </li>
          )
        })}
      </ul>
    </SettingGroup>
  )
}
