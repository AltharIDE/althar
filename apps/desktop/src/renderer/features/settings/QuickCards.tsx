import { ControlGrid, type ControlPlace, ControlToggle, Icon, type IconName } from '@althar/ui'

import { SYSTEM_SOUND } from '../../../main/notify'
import { platform } from '../../shared/device'
import type { PreferencesModel } from '../../shared/usePreferences'
import type { Section } from './sections'
import { text } from './text'

/*
 * What is changed most often, one press each, as round switches: keeping
 * this computer awake while work runs, notifications, their sound, and how
 * hard it works in the bar. Two to a row in the quick settings; one under
 * another down the side of the Settings tab. A card's circle turns it on or
 * off; its name opens the section it is in. The sound comes back as it
 * was: turning Sound off keeps the one there was, to put back.
 */

interface Card {
  readonly key: string
  readonly title: string
  readonly line: string
  readonly on: boolean
  readonly set: (on: boolean) => void
  readonly glyph: IconName
  readonly section: Section
}

/**
 * The sound turning Sound on puts back: the one there was before it was
 * silenced; before any, Glass where this Mac has it, else its first, and
 * off a Mac the system's own.
 */
export const soundToPutBack = (lastSound: string | null, sounds: ReadonlyArray<string>, system: string = platform): string => {
  if (lastSound !== null) return lastSound
  if (system !== 'darwin') return SYSTEM_SOUND
  return sounds.includes('Glass') ? 'Glass' : (sounds[0] ?? SYSTEM_SOUND)
}

/** The cards, as the preferences stand. */
export const cardsOf = ({ preferences, set }: PreferencesModel, sounds: ReadonlyArray<string>): ReadonlyArray<Card> => {
  const notifying = preferences.notifyCalls || preferences.notifyReady || preferences.notifyStopped
  return [
    {
      key: 'awake',
      title: text.awake,
      line: preferences.keepAwake ? text.awakeOn : text.off,
      on: preferences.keepAwake,
      set: (on) => set('keepAwake', on),
      glyph: 'cup',
      section: 'this-mac',
    },
    {
      key: 'notify',
      title: text.notify,
      line: notifying ? text.notifyOn : text.off,
      on: notifying,
      // The round switch turns every kind of notification on or off together.
      set: (on) => {
        set('notifyCalls', on)
        set('notifyReady', on)
        set('notifyStopped', on)
      },
      glyph: 'bell',
      section: 'notifications',
    },
    {
      key: 'sound',
      title: text.sound,
      line: preferences.sound === null ? text.silent : preferences.sound === SYSTEM_SOUND ? text.systemSound : preferences.sound,
      on: preferences.sound !== null,
      set: (on) => {
        if (on) return set('sound', soundToPutBack(preferences.lastSound, sounds))
        if (preferences.sound === null) return
        set('lastSound', preferences.sound)
        set('sound', null)
      },
      glyph: 'sound',
      section: 'notifications',
    },
    {
      key: 'load',
      title: text.load,
      line: preferences.showLoad ? text.loadOn : text.off,
      on: preferences.showLoad,
      set: (on) => set('showLoad', on),
      glyph: 'load',
      section: 'this-mac',
    },
  ]
}

/** Where the `i`th card sits: two to a row, or one under another down the side. */
const placeOf = (i: number, side: boolean): ControlPlace => {
  const row = side ? 1 + i * 2 : 1 + Math.floor(i / 2) * 2
  return { column: side || i % 2 === 0 ? [1, 3] : [3, 5], row: [row, row + 2] }
}

export function QuickCards({
  preferences,
  sounds,
  onSection,
  side = false,
}: {
  preferences: PreferencesModel
  /** This Mac's alert sounds, for the one Sound puts back before there was another. */
  sounds: ReadonlyArray<string>
  /** A card's name was pressed: the section it is in. */
  onSection: (section: Section) => void
  /** Down the side of the Settings tab, one under another. */
  side?: boolean
}) {
  return (
    <ControlGrid row={28} columns={side ? 2 : 4}>
      {cardsOf(preferences, sounds).map((card, i) => (
        <ControlToggle
          key={card.key}
          title={card.title}
          line={card.line}
          on={card.on}
          onChange={card.set}
          glyph={<Icon name={card.glyph} size={16} />}
          onOpen={() => onSection(card.section)}
          place={placeOf(i, side)}
        />
      ))}
    </ControlGrid>
  )
}
