import { queryOptions } from '@tanstack/react-query'
import type { SearchDocument } from '@althar/contracts'
import type { Client } from '../../data/client'

/** Every page, in order: the runtime bounds the passages (the latest only), so every task, link and note stays. */
export const catalogKey = ['searchDocuments'] as const
export const catalogRead = (client: Client) =>
  queryOptions({
    queryKey: catalogKey,
    queryFn: async ({ signal }) => {
      const documents: SearchDocument[] = []
      let after: string | undefined
      do {
        signal.throwIfAborted()
        const page = await client.getSearchDocuments(after)
        documents.push(...page.documents)
        after = page.next ?? undefined
      } while (after !== undefined)
      signal.throwIfAborted()
      return documents
    },
    staleTime: 30_000,
  })
