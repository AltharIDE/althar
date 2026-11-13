import { queryOptions } from '@tanstack/react-query'
import type { SearchDocument } from '@althar/contracts'
import type { Client } from '../../data/client'

/** Pages read at most (200 each): a profile beyond this is searched on its latest, not by hundreds of reads. */
const PAGES = 40

export const catalogKey = ['searchDocuments'] as const
export const catalogRead = (client: Client) =>
  queryOptions({
    queryKey: catalogKey,
    queryFn: async ({ signal }) => {
      const documents: SearchDocument[] = []
      let after: string | undefined
      let pages = 0
      do {
        signal.throwIfAborted()
        const page = await client.getSearchDocuments(after)
        documents.push(...page.documents)
        after = page.next ?? undefined
      } while (after !== undefined && ++pages < PAGES)
      signal.throwIfAborted()
      return documents
    },
    staleTime: 30_000,
  })
