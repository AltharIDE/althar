// Throwaway: the coordinator's dictation, kept by its project's thread.
import type { Dispatch, SetStateAction } from 'react'

import type { DictationOptions, Voice } from '../../../src/renderer/shared/dictation/useDictation'
import { useVoiceFor } from './voiceHook'

export const SHORTCUT = '⌘⇧D'

export function useDictation(setDraft: Dispatch<SetStateAction<string>>, options: DictationOptions = {}): Voice {
  return useVoiceFor(`coordinator:${options.projectId ?? 'p1'}`, setDraft)
}
