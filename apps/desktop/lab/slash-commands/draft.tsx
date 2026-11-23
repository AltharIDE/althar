import { useMemo } from 'react'

import { DraftComposer as AppDraftComposer } from '../../src/renderer/shared/DraftComposer'
import { whereOf } from './data'
import { Where } from './SlashComposer'

/*
 * The app's DraftComposer, as its screens take it in the lab: the same, and
 * telling the composer inside it which it is (its draft is its thread's), so
 * it offers what that composer's commands are.
 */
export function DraftComposer(props: Parameters<typeof AppDraftComposer>[0]) {
  const where = useMemo(() => whereOf(props.draft), [props.draft])
  return (
    <Where.Provider value={where}>
      <AppDraftComposer {...props} />
    </Where.Provider>
  )
}
