import { useNavigate } from '@tanstack/react-router'

import { MOST_AT_ONCE } from '@althar/contracts'
import {
  AgentsAtOnce,
  AppVersion,
  Button,
  ControlCenter,
  ControlFoot,
  ControlFootStart,
  ControlSheet,
  fewerOf,
  IconButton,
  LinkButton,
  Problem,
} from '@althar/ui'

import { useServices } from '../../data/services'
import { useAppVersion } from '../../shared/appVersion'
import { CHANGELOG } from '../../shared/links'
import { usePlaces } from '../../shared/usePlaces'
import { usePreferences } from '../../shared/usePreferences'
import { useSounds } from '../../shared/useSounds'
import { QuickCards } from './QuickCards'
import type { Section } from './sections'
import s from './Settings.module.css'
import { text } from './text'
import { useAgentsAtOnce } from './useAgentsAtOnce'
import { useSettingsHome } from './home'

/*
 * Althar's quick settings, from the gear at the end of the window's bar, on
 * every screen: the kit's Control Center, holding only what is changed
 * often. Round switches for keeping this computer awake while work runs,
 * notifications, their sound, and how hard it works in the bar; under them,
 * how many agents work at once, on a track of its own. In the foot, at its
 * start, which Althar this is with Report a problem (DEV-61) under it, which
 * closes the panel for its dialog, and at its end, on the same row, All settings, which opens the Settings tab beside the home's;
 * a card's name opens it at that card's section. Of what is running it says
 * only, at the number, that fewer agents may work for now while this
 * computer is under load, and why: settings are calm.
 */

export interface QuickSettingsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Opens the Settings tab: at a section, or where it was last. */
  onSettings: (section: Section | null) => void
}

export function QuickSettings({ open, onOpenChange, onSettings }: QuickSettingsProps) {
  const { host } = useServices()
  const { reportProblem } = host
  const preferences = usePreferences()
  const sounds = useSounds()
  const atOnce = useAgentsAtOnce()
  const home = useSettingsHome()
  const places = usePlaces(open)
  const version = useAppVersion()
  const navigate = useNavigate()
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
          <Problem size="small" className={s.failed}>
            {text.failed}
          </Problem>
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
              disabled={!atOnce.canSet}
              fewer={places === null ? null : fewerOf(places)}
              text={{ value: text.atOnce(home.name).value }}
            />
            {atOnce.failed && (
              <Problem size="small" className={s.failed}>
                {text.failed}
              </Problem>
            )}
          </ControlSheet>
        )}
      </div>
      <ControlFoot>
        <ControlFootStart>
          {version !== undefined && (
            <AppVersion
              version={version}
              notes={CHANGELOG}
              // What's new is Althar's own page, in the window; leaving for it closes the panel.
              onNotes={() => {
                onOpenChange(false)
                void navigate({ to: '/althar' })
              }}
              text={{ name: text.version }}
            />
          )}
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
        </ControlFootStart>
        <Button size="small" icon="gear" kbd={text.allKbd} onClick={() => settings(null)}>
          {text.all}
        </Button>
      </ControlFoot>
    </ControlCenter>
  )
}
