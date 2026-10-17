/** How far a plan window has run down: the share left, at the thresholds the warnings come at (50, 25, 10 and 5%). */
export enum UsageTone {
  /** More than half is left. */
  Plenty = 'plenty',
  Half = 'half',
  Low = 'low',
  Critical = 'critical',
  Last = 'last',
}

/** The tone of a window with `left` percent of it left. */
export const usageTone = (left: number): UsageTone => {
  if (left <= 5) return UsageTone.Last
  if (left <= 10) return UsageTone.Critical
  if (left <= 25) return UsageTone.Low
  if (left <= 50) return UsageTone.Half
  return UsageTone.Plenty
}
