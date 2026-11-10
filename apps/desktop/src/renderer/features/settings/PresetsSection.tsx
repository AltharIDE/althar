import { useQuery, useQueryClient } from '@tanstack/react-query'

import { Button, Icon, SettingList, SettingRow } from '@althar/ui'

import { useServices } from '../../data/services'

/*
 * The person's presets (a task is a conversation plus parts, "Presets"):
 * named sets of a task's starting parts, the built-in ones and their own,
 * each with what it holds. Their own, saved from a task or kept from the
 * coordinator's offer, can be removed here; nobody has to use this page.
 */

export const presetsText = {
  title: 'Presets',
  builtIn: 'Built in',
  remove: 'Remove',
  none: 'Save one from any task’s menu, or keep the one the coordinator offers.',
}

const PRESETS = ['presets'] as const

export function PresetsSection() {
  const { client } = useServices()
  const cache = useQueryClient()
  const presets = useQuery({ queryKey: PRESETS, queryFn: () => client.listPresets() }).data
  if (presets === undefined) return null
  const own = presets.filter((one) => !one.builtin)
  return (
    <SettingList>
      {presets.map((preset) => (
        <SettingRow key={preset.id} title={preset.name} note={preset.about} glyph={<Icon name="list" size={15} />}>
          {() =>
            preset.builtin ? (
              <span>{presetsText.builtIn}</span>
            ) : (
              <Button
                size="small"
                variant="quiet"
                onClick={() => void client.removePreset(preset.id).then(() => cache.invalidateQueries({ queryKey: PRESETS }))}
              >
                {presetsText.remove}
              </Button>
            )
          }
        </SettingRow>
      ))}
      {own.length === 0 && <SettingRow title={presetsText.none}>{() => null}</SettingRow>}
    </SettingList>
  )
}
