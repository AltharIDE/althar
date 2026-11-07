import { useCallback, useEffect, useState } from 'react'

import type { TaskFolderState } from '../../../main/appPreferences'
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

  const change = useCallback(() => {
    if (host.chooseTaskFolder === undefined) return
    setBusy(true)
    setRefusal(null)
    host.chooseTaskFolder().then(
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
  }, [host])

  return state === null ? null : { ...state, change, busy, refusal }
}
