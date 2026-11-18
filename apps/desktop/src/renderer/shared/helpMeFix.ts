import { type RefObject, useCallback, useEffect, useState } from 'react'

import { draftOf as draftNow, setDraftText, subscribeDraft } from './drafts'
import type { RunContent } from './thread'

/*
 * "Help me fix it" on a failed run's card: a prompt in the thread's composer,
 * never sent, with the end of what the run printed in it (the agent can't read a
 * run's console itself). Where nothing is written, nothing is attached and the
 * agent is free, it is the composer's suggestion, in grey, for Tab to take; where
 * anything of that is so (a suggestion isn't shown then), it goes under the words
 * on a new line. The composer takes focus at once; the prompt follows as soon as
 * the output is read, a local file.
 */

type Fix = Pick<RunContent, 'name' | 'command' | 'ended'>

/** How much of the end of the output goes in the prompt. */
const LINES = 40
const CHARS = 4_000

/** The end of what a run printed, cut to what a prompt can hold. */
export const tailOf = (text: string): string => {
  const end = text.trimEnd().split('\n').slice(-LINES).join('\n')
  return end.length > CHARS ? `…${end.slice(-CHARS)}` : end
}

/** The prompt, naming the run and how it ended, with the end of its output where there is one. */
export const helpPrompt = (run: Fix, tail?: string) => {
  const called = run.name == null || run.name === run.command ? `\`${run.command}\`` : `“${run.name}”`
  const code = run.ended?.code
  const how = code == null ? 'failed' : `failed with exit code ${code}`
  const out =
    tail === undefined || tail.trim() === ''
      ? `Its output is no longer kept${run.ended?.last == null ? '' : `; the last line it printed was: ${run.ended.last}`}. Run it again to see it.`
      : `The end of its output:\n\`\`\`\n${tail}\n\`\`\``
  return `Help me fix it: ${called} ${how}. ${out}\nFind out why and fix it.`
}

export function useHelpMeFix(key: string, busy: boolean, input: RefObject<HTMLTextAreaElement | null>) {
  const [suggestion, setSuggestion] = useState<string | undefined>(undefined)
  // Taken, or written over: it is no longer suggested. Listened to here, not read as state, so a word typed never draws the screen.
  useEffect(
    () =>
      subscribeDraft(key, () => {
        if (draftNow(key).text.trim() !== '') setSuggestion(undefined)
      }),
    [key],
  )
  const place = useCallback(
    (prompt: string) => {
      const now = draftNow(key)
      // Where the composer shows no suggestion (words, an image or file, a working agent), it goes into the words.
      if (now.text.trim() === '' && now.images.length === 0 && now.files.length === 0 && !busy) setSuggestion(prompt)
      else setDraftText(key, (text) => (text.trim() === '' ? prompt : `${text.replace(/\s+$/, '')}\n${prompt}`))
    },
    [key, busy],
  )
  const help = useCallback(
    (run: Fix, output: () => Promise<string | undefined>) => {
      input.current?.focus()
      output().then(
        (text) => place(helpPrompt(run, text === undefined ? undefined : tailOf(text))),
        () => place(helpPrompt(run)),
      )
    },
    [input, place],
  )
  return { suggestion, help }
}
