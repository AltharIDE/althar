import { useEffect, useRef } from 'react'

/*
 * A drawing kept as a page fragment while its style is being chosen: its
 * style, its root and its script, as the style explorations were made. On
 * the client its style goes into the head once, its root into place, and its
 * script runs right after the root it finds as its previous sibling. Nothing
 * is drawn on the server; the tile keeps its room until it is.
 */

/** Styles already in the head, by the fragment that brought them. */
const styled = new Set<string>()

/** `tone` is put on the host, where a fragment drawn in two tones looks for it. A fragment with words and links of its own is not `decorative`. */
export function Fragment({
  source,
  tone,
  className,
  decorative = true,
}: {
  source: string
  tone?: string
  className?: string
  decorative?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current
    if (!el || el.childElementCount > 0) return
    const parts = document.createElement('template')
    parts.innerHTML = source
    for (const style of parts.content.querySelectorAll('style')) {
      if (!styled.has(source)) document.head.appendChild(style.cloneNode(true))
      style.remove()
    }
    styled.add(source)
    const scripts = [...parts.content.querySelectorAll('script')]
    for (const script of scripts) script.remove()
    el.appendChild(parts.content)
    for (const script of scripts) {
      const run = document.createElement('script')
      run.textContent = script.textContent
      el.appendChild(run)
    }
  }, [source])
  return <div ref={host} className={className} data-tone={tone} aria-hidden={decorative || undefined} />
}
