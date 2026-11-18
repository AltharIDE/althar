import { type ReactNode, useId } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Logo } from '../../foundations/Logo/Logo'
import { cx } from '../../lib/cx'
import { safeHref } from '../../lib/safeHref'
import { Button } from '../../primitives/Button/Button'
import { Switch } from '../../primitives/Switch/Switch'
import { SettingGroup } from '../Preferences/Preferences'
import s from './AboutAlthar.module.css'

/*
 * The head of About Althar: Althar's mark, its name and version under a
 * small Early access label, an update ready under them where there is one,
 * and at the end the ways out: the website, what's new there, the community,
 * and Report a problem where the app can report. Monochrome: nothing here
 * needs the person.
 */

export interface AboutHeaderText {
  /** The label over the name, which says what stage Althar is at. */
  stage: string
  name: (version: string) => string
  website: string
  notes: string
  community: string
  report: string
}

export const aboutHeaderText: AboutHeaderText = {
  stage: 'Early access',
  name: (version) => `Althar ${version}`,
  website: 'Website',
  notes: 'What’s new',
  community: 'Discord',
  report: 'Report a problem',
}

export interface AboutHeaderProps {
  /** As words: 0.1.0; the name alone until it is known. */
  version?: string
  /** Under the name: an update ready to install, where there is one. */
  update?: ReactNode
  /** Where each opens, in the browser; one left out isn't shown. */
  website?: string
  notes?: string
  community?: string
  /** Report a problem; without it, the app can't report. */
  onReport?: () => void
  text?: Partial<AboutHeaderText>
  className?: string
}

export function AboutHeader({ version, update, website, notes, community, onReport, text, className }: AboutHeaderProps) {
  const t = { ...aboutHeaderText, ...text }
  return (
    <header className={cx(s.header, className)}>
      <Logo size={36} />
      <span className={s.words}>
        <span className={s.stage}>{t.stage}</span>
        <strong className={s.name}>{version === undefined ? 'Althar' : t.name(version)}</strong>
        {update}
      </span>
      <span className={s.ways}>
        <Out href={website}>{t.website}</Out>
        <Out href={notes}>{t.notes}</Out>
        <Out href={community} mark={<DiscordMark />}>
          {t.community}
        </Out>
        {onReport !== undefined && (
          <Button size="small" onClick={onReport}>
            {t.report}
          </Button>
        )}
      </span>
    </header>
  )
}

/** A way out to the browser, looking as a small button does. */
function Out({ href, mark, children }: { href: string | undefined; mark?: ReactNode; children: string }) {
  const safe = safeHref(href)
  if (safe === undefined) return null
  return (
    <a className={s.out} href={safe} target="_blank" rel="noreferrer">
      {mark}
      {children}
      <Icon name="external" size={11} />
    </a>
  )
}

/** Discord's mark, from Simple Icons (CC0), in the text's colour. */
function DiscordMark() {
  return (
    <svg className={s.mark} viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path
        fill="currentColor"
        d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  )
}

/* ---- help improve Althar: usage data and crash reports, side by side ---------------- */

export interface HelpImproveText {
  title: string
  /** What both send and never send. */
  note: string
  usage: string
  crashes: string
  /** Why both are off, whatever was chosen. */
  doNotTrack: string
}

export const helpImproveText: HelpImproveText = {
  title: 'Help improve Althar',
  note: 'Anonymous. Never your code or any name.',
  usage: 'Usage data',
  crashes: 'Crash reports',
  doNotTrack: 'Off while DO_NOT_TRACK is set.',
}

export interface HelpImproveProps {
  usage: boolean
  onUsage: (on: boolean) => void
  crashes: boolean
  onCrashes: (on: boolean) => void
  /** DO_NOT_TRACK is set where Althar started: both off, whatever was chosen, and not turned on here. */
  doNotTrack?: boolean
  text?: Partial<HelpImproveText>
}

/** Whether Althar sends anonymous usage data and crash reports: a switch each, side by side, under the one line on what they send. */
export function HelpImprove({ usage, onUsage, crashes, onCrashes, doNotTrack = false, text }: HelpImproveProps) {
  const t = { ...helpImproveText, ...text }
  const id = useId()
  const note = `${id}-n`
  return (
    <SettingGroup title={t.title} note={<span id={note}>{doNotTrack ? t.doNotTrack : t.note}</span>}>
      <div className={s.pair}>
        <Pair title={t.usage} on={usage && !doNotTrack} onChange={onUsage} disabled={doNotTrack} note={note} />
        <Pair title={t.crashes} on={crashes && !doNotTrack} onChange={onCrashes} disabled={doNotTrack} note={note} />
      </div>
    </SettingGroup>
  )
}

function Pair({
  title,
  on,
  onChange,
  disabled,
  note,
}: {
  title: string
  on: boolean
  onChange: (on: boolean) => void
  disabled: boolean
  note: string
}) {
  const id = useId()
  return (
    <div className={s.one}>
      <span id={id}>{title}</span>
      <Switch checked={on} onChange={onChange} disabled={disabled} labelledBy={id} describedBy={note} />
    </div>
  )
}
