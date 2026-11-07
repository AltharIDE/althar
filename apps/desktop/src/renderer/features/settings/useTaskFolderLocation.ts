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

export const text = {
  failed: 'That folder couldn’t be kept. Try again.',
  defaultFailed: 'Couldn’t go back to the default folder. Try again.',
}

export const useTaskFolderLocation = (): TaskFolderLocationModel | null => {
  const { host } = useServices()
  const [state, setState] = useState<TaskFolderState | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  // As it stands now, not as it was when the page opened: a drive may have gone or come back since.
  useEffect(() => {
    let live = true
    const read = () =>
      void host.taskFolder?.().then(
        (now) => live && setState(now),
        () => undefined,
      )
    read()
    window.addEventListener('focus', read)
    return () => {
      live = false
      window.removeEventListener('focus', read)
    }
  }, [host])

  const ask = useCallback((asking: (() => Promise<TaskFolderChoice>) | undefined, failed: string) => {
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
        setRefusal(failed)
      },
    )
  }, [])
  const change = useCallback(() => ask(host.chooseTaskFolder, text.failed), [ask, host])
  const useDefault = useCallback(() => ask(host.useDefaultTaskFolder, text.defaultFailed), [ask, host])

  return state === null ? null : { ...state, change, useDefault, busy, refusal }
}
