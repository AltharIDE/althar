/** The local startup steps, shared by main, preload and the window. */
export type StartupStage = 'device' | 'data' | 'screen'
export const isStartupStage = (value: unknown): value is StartupStage => value === 'device' || value === 'data' || value === 'screen'
