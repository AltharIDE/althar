import { type QueryClient, queryOptions } from '@tanstack/react-query'
import type { FinderQuery, SearchDocument, SearchDocuments } from '@althar/contracts'
import type { Client } from '../../data/client'

export const catalogKey = ['searchDocuments'] as const
const oldHomes = new WeakSet<Client>()
const freshness = 30_000

const olderCatalog = (client: Client, cache: QueryClient, first?: SearchDocuments) =>
  cache.fetchQuery({
    queryKey: [...catalogKey, 'legacy'],
    staleTime: freshness,
    gcTime: freshness,
    queryFn: async ({ signal }) => {
      const start = first ?? (await client.getSearchDocuments(undefined, undefined, signal))
      const documents: SearchDocument[] = [...start.documents]
      let after = start.next
      while (after !== null) {
        signal.throwIfAborted()
        const page = await client.getSearchDocuments(after, undefined, signal)
        documents.push(...page.documents)
        after = page.next
      }
      return documents
    },
  })

export const catalogRead = (client: Client, input: FinderQuery, enabled = true) =>
  queryOptions({
    queryKey: [...catalogKey, input],
    enabled,
    queryFn: async ({ signal, client: cache }) => {
      let first: SearchDocuments | undefined
      if (!oldHomes.has(client)) {
        first = await client.getSearchDocuments(undefined, { ...input, text: input.text.slice(0, 500) }, signal)
        if (first.indexed === true) return { documents: first.documents, indexing: first.indexing === true }
        oldHomes.add(client)
      }
      // An older home supplies one shared catalog while the palette is in use.
      const documents = await olderCatalog(client, cache, first)
      signal.throwIfAborted()
      return {
        documents: documents.filter(
          (document) =>
            (input.projectId === undefined || document.projectId === input.projectId) &&
            (input.kinds === undefined || input.kinds.includes(document.kind)),
        ),
        indexing: false,
      }
    },
    staleTime: freshness,
    gcTime: freshness,
    refetchInterval: (query) => (query.state.data?.indexing === true ? 1000 : false),
  })
