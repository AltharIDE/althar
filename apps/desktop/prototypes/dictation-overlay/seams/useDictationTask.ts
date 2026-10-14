// Throwaway: a task's dictation, kept by its thread: the one the window opened, read once, since each task has a screen of its own.
import { useRouterState } from '@tanstack/react-router'
import { type Dispatch, type SetStateAction, useState } from 'react'

import type { Voice } from '../../../src/renderer/shared/dictation/useDictation'
import { useVoiceFor } from './voiceHook'

export const SHORTCUT = '⌘⇧D'

export function useDictation(setDraft: Dispatch<SetStateAction<string>>): Voice {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const [key] = useState(() => `thread:${path.split('/')[2] ?? ''}`)
  return useVoiceFor(key, setDraft)
}
