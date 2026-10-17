import { useQuery } from '@tanstack/react-query'

import { MOST_AT_ONCE } from '@althar/contracts'
import { AgentsAtOnce, AppVersion, Button, ControlCenter, ControlFoot, ControlSheet, IconButton, LinkButton } from '@althar/ui'

import { notesOf } from '../../../main/updates'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { usePreferences } from '../../shared/usePreferences'
import { useSounds } from '../../shared/useSounds'
import { QuickCards } from './QuickCards'
import type { Section } from './sections'
import s from './Settings.module.css'
import { text } from './text'
import { useAgentsAtOnce } from './useAgentsAtOnce'

/*
 * Althar's quick settings, from the gear at the end of the window's bar, on
 * every screen: the kit's Control Center, holding only what is changed
 * often. Round switches for keeping this computer awake while work runs,
 * notifications, their sound, and how hard it works in the bar; under them,
 * how many agents work at once, on a track of its own. In the foot, which
 * Althar this is, Report a problem (DEV-61), which closes the panel for its
 * dialog, and All settings, which opens the Settings tab beside the home's;
 * a card's name opens it at that card's section. Nothing in it says what is
 * running: settings are calm.
 */

export interface QuickSettingsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opens the Settings tab: at a section, or where it was last. */
  onSettings: (section: Section | null) => void
}

export function QuickSettings({ open, onOpenChange, onSettings }: QuickSettingsProps) {
  const { client, host } = useServices()
  const { reportProblem } = host
  const preferences = usePreferences()
  const sounds = useSounds()
  const atOnce = useAgentsAtOnce()
  const version = useQuery(reads(client).status()).data?.appVersion
  // Leaving for the Settings tab closes the panel.
  const settings = (section: Section | null) => {
    onOpenChange(false)
    onSettings(section)
  }
  return (
    <ControlCenter
      trigger={<IconButton icon="gear" label={text.gear} kbd={text.kbd} size="small" />}
      open={open}
      onOpenChange={onOpenChange}
      text={{ label: text.quick }}
    >
      <div className={s.quick}>
        <QuickCards preferences={preferences} sounds={sounds.list} onSection={settings} />
        {preferences.failed && (
          <p role="alert" className={s.failed}>
            {text.failed}
          </p>
        )}
        {atOnce !== null && (
          <ControlSheet>
            <AgentsAtOnce
              compact
              count={atOnce.atOnce.count}
              own={atOnce.atOnce.own !== null}
              machine={atOnce.atOnce.machine}
              most={MOST_AT_ONCE}
              onChange={atOnce.set}
              text={{ value: text.atOnceValue }}
            />
            {atOnce.failed && (
              <p role="alert" className={s.failed}>
                {text.failed}
              </p>
            )}
          </ControlSheet>
        )}
      </div>
      <ControlFoot>
        {version !== undefined && <AppVersion version={version} notes={notesOf(version)} text={{ name: text.version }} />}
        {reportProblem !== undefined && (
          <LinkButton
            onClick={() => {
              // The panel closes, and the dialog opens over the window.
              onOpenChange(false)
              reportProblem({ kind: 'asked', from: 'settings' })
            }}
          >
            {text.report}
          </LinkButton>
        )}
        <Button size="small" icon="gear" kbd={text.allKbd} onClick={() => settings(null)}>
          {text.all}
        </Button>
      </ControlFoot>
    </ControlCenter>
  )
}
