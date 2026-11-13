import { useId } from 'react'

import { device } from '../../foundations/device'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { RuntimeState } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Tooltip } from '../../primitives/HoverCard/HoverCard'
import { Problem } from '../../primitives/Problem/Problem'
import { Spinner } from '../../primitives/Spinner/Spinner'
import type { PinnedDownload, RuntimeEntry, RuntimesProps } from '../Runtimes/Runtimes'
import s from './AgentsAway.module.css'

/*
 * The agents Althar runs that aren't on this computer, under those that are:
 * a heading quieter than theirs, and a small tile each, side by side where
 * there is room, so many more fit in a few lines. A tile is the agent's mark
 * and name, and its one way in: a download, about so big, where Althar can
 * fetch it (where from, on its tooltip); else the agent's own instructions.
 * While one downloads its tile says so, and one that didn't finish says why,
 * with a way to try again. Those Althar can fetch come first.
 */

export interface AgentsAwayText {
  title: string
  /** The list, read out. */
  label: string
  /** A tile's download, read out: Download OpenCode, 45 MB. */
  downloadNamed: (name: string, size: string) => string
  /** Where a download comes from, on its button's tooltip: a release's latest on GitHub, or one version its maker publishes. */
  downloadFrom: (pinned?: PinnedDownload) => string
  downloading: (size: string) => string
  install: string
  installNamed: (name: string) => string
  tryAgain: string
  tryAgainNamed: (name: string, size: string) => string
}

export const agentsAwayText: AgentsAwayText = {
  title: `Not on ${device.this}`,
  label: `Agents not on ${device.this}`,
  downloadNamed: (name, size) => `Download ${name}, ${size}`,
  downloadFrom: (pinned) => (pinned === undefined ? 'Its latest release, from GitHub' : `${pinned.version}, from ${pinned.from}`),
  downloading: (size) => `Downloading, ${size}…`,
  install: 'How to install',
  installNamed: (name) => `How to install ${name}`,
  tryAgain: 'Try again',
  tryAgainNamed: (name, size) => `Try again to download ${name}, ${size}`,
}

export interface AgentsAwayProps extends Pick<RuntimesProps, 'onInstall' | 'onHelp'> {
  /** The agents not on this computer: missing, or downloading. */
  agents: readonly RuntimeEntry[]
  className?: string
  text?: Partial<AgentsAwayText>
}

/** Whether Althar can fetch an agent that isn't on this computer, or is fetching it. */
const fetchable = (r: RuntimeEntry) => r.state === RuntimeState.Installing || (r.state === RuntimeState.Missing && r.download !== undefined)

/** The agents not on this computer, a tile each with its one way in. */
export function AgentsAway({ agents, onInstall, onHelp, className, text }: AgentsAwayProps) {
  const t = { ...agentsAwayText, ...text }
  const id = useId()
  if (agents.length === 0) return null
  const ordered = [...agents.filter(fetchable), ...agents.filter((r) => !fetchable(r))]
  return (
    <section className={cx(s.away, className)} aria-labelledby={id}>
      <h2 id={id} className={s.title}>
        {t.title}
      </h2>
      <ul className={s.tiles} aria-label={t.label}>
        {ordered.map((r) => (
          <li key={r.id} className={s.tile}>
            <span className={s.mark}>{r.brand ? <BrandMark brand={r.brand} size={16} /> : <Icon name="plug" size={15} />}</span>
            <span className={s.name} title={r.name}>
              {r.name}
            </span>
            <span className={s.way}>{wayOf(r, t, onInstall, onHelp)}</span>
            {r.state === RuntimeState.Missing && r.failed !== undefined && (
              <Problem as="span" size="small" className={s.failed}>
                {r.failed}
              </Problem>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A tile's one way in: downloading, a download, or the agent's own instructions; nothing where it has none. */
function wayOf(r: RuntimeEntry, t: AgentsAwayText, onInstall: RuntimesProps['onInstall'], onHelp: RuntimesProps['onHelp']) {
  if (r.state === RuntimeState.Installing)
    return (
      <output className={s.busy}>
        <Spinner size="small" />
        {t.downloading(r.download)}
      </output>
    )
  if (r.state !== RuntimeState.Missing) return null
  if (r.download !== undefined && onInstall !== undefined)
    return (
      <Tooltip label={t.downloadFrom(r.pinned)} placement="above" align="end">
        <Button
          size="small"
          {...(r.failed === undefined ? { icon: 'download' as const } : {})}
          aria-label={r.failed === undefined ? t.downloadNamed(r.name, r.download) : t.tryAgainNamed(r.name, r.download)}
          onClick={() => onInstall(r.id)}
        >
          {r.failed === undefined ? r.download : t.tryAgain}
        </Button>
      </Tooltip>
    )
  if (onHelp !== undefined && r.guide !== false)
    return (
      <ActionButton icon="external" flush="end" aria-label={t.installNamed(r.name)} onClick={() => onHelp(r.id)}>
        {t.install}
      </ActionButton>
    )
  return null
}
