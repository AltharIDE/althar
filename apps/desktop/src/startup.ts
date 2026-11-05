/** The local steps a slow opening can explain, shared by main, preload and the window. */
export type StartupStage = 'device' | 'data' | 'screen'
export const isStartupStage = (value: unknown): value is StartupStage => value === 'device' || value === 'data' || value === 'screen'
export const startupWords: Readonly<Record<StartupStage, string>> = {
  device: 'Checking this computer…',
  data: 'Opening your data…',
  screen: 'Reading your data…',
}
