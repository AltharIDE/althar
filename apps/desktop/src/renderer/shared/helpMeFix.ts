import { type RefObject, useCallback, useEffect, useState } from 'react'

import { draftOf as draftNow, setDraftText, useDraftWords } from './drafts'
import type { RunContent } from './thread'

/*
 * "Help me fix it" on a failed run's card: a prompt in the thread's composer,
 * never sent. Where nothing is written and the agent is free, it is the
 * composer's suggestion, in grey, for Tab to take; where words are written, or
 * the agent works (a suggestion isn't shown then), it goes under them on a new
 * line, and the field takes focus. The person only has to send it.
 */

/** The prompt, naming the run, how it ended and where its output is. */
export const helpPrompt = (run: Pick<RunContent, 'name' | 'command' | 'ended'>) => {
  const called = run.name == null || run.name === run.command ? `\`${run.command}\`` : `“${run.name}”`
  const code = run.ended?.code
  const how = code == null ? 'failed' : `failed with exit code ${code}`
  return `Help me fix it: ${called} ${how}. Its output is under Output on its run card in this thread: read it, find out why and fix it.`
}

export function useHelpMeFix(key: string, busy: boolean, input: RefObject<HTMLTextAreaElement | null>) {
  const [suggestion, setSuggestion] = useState<string | undefined>(undefined)
  const written = useDraftWords(key, (text) => text.trim() !== '')
  // Taken, or written over: it is no longer suggested.
  useEffect(() => {
    if (written) setSuggestion(undefined)
  }, [written])
  const help = useCallback(
    (run: Pick<RunContent, 'name' | 'command' | 'ended'>) => {
      const prompt = helpPrompt(run)
      if (draftNow(key).text.trim() === '' && !busy) setSuggestion(prompt)
      else setDraftText(key, (now) => (now.trim() === '' ? prompt : `${now.replace(/\s+$/, '')}\n${prompt}`))
      input.current?.focus()
    },
    [key, busy, input],
  )
  return { suggestion, help }
}
