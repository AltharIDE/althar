/*
 * Keeps the Mac awake while work runs (Linear DEV-14). A sleeping Mac stops
 * every agent, which looks like a hung run, so while any task runs or waits
 * Althar holds the system's app-suspension assertion: the Mac stays up and
 * the display may still sleep. Only while the person wants it, and only on
 * battery if they said so too. Released as soon as nothing runs.
 */

export interface Power {
  /** Starts holding the Mac awake; the hold's id. */
  readonly hold: () => number
  readonly release: (id: number) => void
  readonly onBattery: () => boolean
}

/** Holds the Mac awake or lets it go as work, the person's choices and the power source change. */
export const keepingAwake = (power: Power) => {
  let held: number | undefined
  let working = false
  let wants = { keepAwake: false, awakeOnBattery: false }

  const settle = () => {
    // On battery is asked last: only while there is work to hold for, since the power source can't be read before the app is ready.
    const hold = working && wants.keepAwake && (wants.awakeOnBattery || !power.onBattery())
    if (hold && held === undefined) held = power.hold()
    if (!hold && held !== undefined) {
      power.release(held)
      held = undefined
    }
  }

  return {
    /** The runtime says whether work runs. */
    working: (now: boolean) => {
      working = now
      settle()
    },
    /** The person's choices, as kept. */
    wants: (now: { readonly keepAwake: boolean; readonly awakeOnBattery: boolean }) => {
      wants = { keepAwake: now.keepAwake, awakeOnBattery: now.awakeOnBattery }
      settle()
    },
    /** The Mac went on battery or was plugged in. */
    powerChanged: settle,
    /** Whether it holds now. */
    holding: () => held !== undefined,
  }
}
