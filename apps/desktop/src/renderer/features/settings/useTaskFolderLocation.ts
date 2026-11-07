import { useCallback, useEffect, useState } from 'react'

import type { TaskFolderChoice, TaskFolderState } from '../../../main/appPreferences'
import { useServices } from '../../data/services'

/*
 * Where new tasks' folders go, as Work on this computer shows it: the folder
 * and who decided (the environment, the person, the platform), and Change,
 * which asks the main process for a folder, checks it and keeps it. A refusal
 * is shown in the line it came in, until the next try. Null where the main
 * process keeps no such setting, as on a page outside the app.
 */

export interface TaskFolderLocationModel extends TaskFolderState {
  readonly change: () => void
  /** Back to where the platform keeps them. */
  readonly useDefault: () => void
  readonly busy: boolean
  /** Why the last choice was refused. */
  readonly refusal: string | null
}

export const text = { failed: 'That folder couldn’t be kept. Try again.' }

export const useTaskFolderLocation = (): TaskFolderLocationModel | null => {
  const { host } = useServices()
  const [state, setState] = useState<TaskFolderState | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void host.taskFolder?.().then(
      (now) => live && setState(now),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [host])

  const ask = useCallback((asking: (() => Promise<TaskFolderChoice>) | undefined) => {
    if (asking === undefined) return
    setBusy(true)
    setRefusal(null)
    asking().then(
      (choice) => {
        setBusy(false)
        if (choice === null) return
        if ('refused' in choice) setRefusal(choice.refused)
        else setState(choice)
      },
      () => {
        setBusy(false)
        setRefusal(text.failed)
      },
    )
  }, [])
  const change = useCallback(() => ask(host.chooseTaskFolder), [ask, host])
  const useDefault = useCallback(() => ask(host.useDefaultTaskFolder), [ask, host])

  return state === null ? null : { ...state, change, useDefault, busy, refusal }
}
