import { SettingSwitch } from '../../../setup/Preferences/Preferences'

/*
 * The setting, as a row of the app's Preferences: whether the readout shows
 * at all, and under it, whether only while work runs. Off by default; the
 * person who wants it turns it on once. Each change goes out at once.
 */

export interface LoadSettingText {
  title: string
  note: string
  onlyRunning: string
  onlyRunningNote: string
}

export const loadSettingText: LoadSettingText = {
  title: 'Show this Mac’s load',
  note: 'CPU and memory in the window’s bar, and what each task uses of them.',
  onlyRunning: 'Only while work runs',
  onlyRunningNote: 'Out of the bar when no task is running.',
}

export interface LoadSettingProps {
  on: boolean
  onChange: (on: boolean) => void
  /** Whether it leaves the bar while no task runs. */
  onlyRunning: boolean
  onOnlyRunningChange: (on: boolean) => void
  text?: Partial<LoadSettingText>
}

export function LoadSetting({ on, onChange, onlyRunning, onOnlyRunningChange, text }: LoadSettingProps) {
  const t = { ...loadSettingText, ...text }
  return (
    <>
      <SettingSwitch title={t.title} note={t.note} checked={on} onChange={onChange} />
      <SettingSwitch
        indent
        title={t.onlyRunning}
        note={t.onlyRunningNote}
        checked={onlyRunning}
        onChange={onOnlyRunningChange}
        disabled={!on}
      />
    </>
  )
}
