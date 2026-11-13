import { useRouterState } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'

import { FinderView as Today } from '../../src/renderer/features/finder/FinderView'
import type { Context } from './index'
import { OneBox } from './OneBox'
import { Said } from './Said'
import { Scopes } from './Scopes'
import { direction, opened, useStore } from './state'

/*
 * What ⌘K opens, in place of the app's finder (the seam in vite.config.ts):
 * the direction the bar has picked, over the window, knowing where the
 * person is. TabsFrame mounts it as it opens and unmounts it as it closes,
 * as it does its own finder. Today is that finder itself.
 */
export function FinderView({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const picked = useStore(direction)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const task = /^\/threads\/th_(.+)$/.exec(pathname)?.[1] ?? null
  const context = useMemo((): Context => ({ project: projectId, task }), [projectId, task])
  useEffect(() => {
    opened.set(true)
    return () => opened.set(false)
  }, [])
  switch (picked) {
    case 'today':
      return <Today projectId={projectId} onClose={onClose} />
    case 'a':
      return <OneBox key="a" context={context} onClose={onClose} />
    case 'b':
      return <Scopes key="b" context={context} onClose={onClose} />
    case 'c':
      return <Said key="c" context={context} onClose={onClose} />
  }
}
