import { Fragment, type ReactNode } from 'react'

type NoteLink = { readonly label: string; readonly url: string; readonly at?: number }

/**
 * A line's words with each label that is a link drawn as one: "Asked ana to review #698" with #698 going to the pull request.
 * A link that says where its label starts (`at`) is drawn there, so "test" links the check named test, not the "test" in
 * "test / linux" before it; one that doesn't is the label's next appearance after the link before it.
 */
export function linkedWords(text: string, links: ReadonlyArray<NoteLink> | undefined): ReactNode {
  if (links === undefined || links.length === 0) return text
  const placed = links
    .map((link, order) => ({ link, order }))
    .toSorted((a, b) => (a.link.at === undefined || b.link.at === undefined ? a.order - b.order : a.link.at - b.link.at))
  const parts: Array<ReactNode> = []
  let from = 0
  for (const { link } of placed) {
    const at = link.at !== undefined && link.at >= from && text.startsWith(link.label, link.at) ? link.at : text.indexOf(link.label, from)
    if (at < 0) continue
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <a href={link.url} target="_blank" rel="noreferrer">
        {link.label}
      </a>,
    )
    from = at + link.label.length
  }
  if (from < text.length) parts.push(text.slice(from))
  return parts.map((part, at) => <Fragment key={at}>{part}</Fragment>)
}
