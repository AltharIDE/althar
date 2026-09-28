import { createContext } from 'react'

/** Set by a host that already shows the exit code, like a failed Tool's row, so the output does not say it twice. Internal to the thread. */
export const ExitShown = createContext(false)
