import { useCallback, useEffect, useRef } from 'react'

import { Composer, type ComposerProps } from '@althar/ui'

import { draftHistory, subscribeDraft, takeDraftFocus, useDraft, wantsDraftFocus } from './drafts'

/**
 * A composer whose words are its thread's draft (`drafts.ts`), read here and
 * nowhere above it: each word typed draws this, and not the screen around it,
 * which changes the words only as it sends them or gives them back
 * (`useSetDraft`). Where words were put in it for the person to go on with
 * (`focusDraft`), it takes the focus as it next shows, its caret after them.
 * Undo in it puts back what was taken off it, in turn with its words
 * (`draftHistory`).
 */
export function DraftComposer({ draft, ...props }: Omit<ComposerProps, 'value' | 'onChange'> & { readonly draft: string }) {
  const [value, setValue] = useDraft(draft)
  const own = useRef<HTMLTextAreaElement>(null)
  const ref = props.inputRef ?? own
  const take = useCallback(() => {
    if (!wantsDraftFocus(draft)) return
    requestAnimationFrame(() => {
      const field = ref.current
      // A screen kept out of sight takes it once it shows.
      const seen = field !== null && (typeof field.checkVisibility !== 'function' || field.checkVisibility())
      if (!seen || !takeDraftFocus(draft)) return
      field.focus()
      field.setSelectionRange(field.value.length, field.value.length)
      field.scrollTop = field.scrollHeight
    })
  }, [draft, ref])
  useEffect(() => subscribeDraft(draft, take), [draft, take])
  // Drawn again as its screen shows: asked while it was out of sight, it takes it now.
  useEffect(take)
  return <Composer history={draftHistory(draft)} {...props} inputRef={ref} value={value} onChange={setValue} />
}
