import { Fragment, type ReactNode } from 'react'

/** A line's words with each label that is a link drawn as one: "Asked ana to review #698" with #698 going to the pull request. */
export function linkedWords(text: string, links: ReadonlyArray<{ readonly label: string; readonly url: string }> | undefined): ReactNode {
  if (links === undefined || links.length === 0) return text
  const parts: Array<ReactNode> = []
  let rest = text
  for (const link of links) {
    const at = rest.indexOf(link.label)
    if (at < 0) continue
    if (at > 0) parts.push(rest.slice(0, at))
    parts.push(
      <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
        {link.label}
      </a>,
    )
    rest = rest.slice(at + link.label.length)
  }
  if (rest !== '') parts.push(rest)
  return parts.map((part, at) => <Fragment key={at}>{part}</Fragment>)
}
