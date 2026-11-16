import { Composer, type ComposerProps } from '@althar/ui'

import { useDraft } from './drafts'

/**
 * A composer whose words are its thread's draft (`drafts.ts`), read here and
 * nowhere above it: each word typed draws this, and not the screen around it,
 * which changes the words only as it sends them or gives them back
 * (`useSetDraft`).
 */
export function DraftComposer({ draft, ...props }: Omit<ComposerProps, 'value' | 'onChange'> & { readonly draft: string }) {
  const [value, setValue] = useDraft(draft)
  return <Composer {...props} value={value} onChange={setValue} />
}
