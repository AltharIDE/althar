import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import { useServices } from '../../data/services'
import { CODE_FRESH, codeKeys } from './finds'

/*
 * A picture a markdown file names beside it (`![flow](docs/flow.png)`), read from where its thread's agent works, as it is
 * now, and drawn in place of the words that stand for it until it comes (and where it can't: a file that isn't a picture,
 * one out of the task's folder, one the coordinator's default branch has).
 */

/** The picture at `path` of a thread's place, or its words while it is read and where it can't be. */
export function FilePicture({ threadId, path, alt, title }: { threadId: string; path: string; alt: string; title?: string }) {
  const { client } = useServices()
  const read = useQuery({
    queryKey: codeKeys.image(threadId, path),
    queryFn: () => client.readCode(threadId, path, { image: true }),
    staleTime: CODE_FRESH,
    gcTime: 5 * 60_000,
    retry: false,
  })
  const image = read.data?.image
  if (image === undefined) return alt
  return <img src={`data:${image.type};base64,${image.data}`} alt={alt} title={title} />
}

/** What the kit's markdown draws a file's images with, for a thread. */
export const pictureOf =
  (threadId: string) =>
  ({ path, alt, title }: { readonly path: string; readonly alt: string; readonly title?: string }): ReactNode => (
    <FilePicture threadId={threadId} path={path} alt={alt} {...(title === undefined ? {} : { title })} />
  )
