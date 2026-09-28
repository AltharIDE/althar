/**
 * A link from outside (an agent, a web page, a tracker) becomes an href only
 * if it is http or https. Anything else, like javascript:, file: or a custom
 * scheme a desktop shell would hand to the system, is not a link.
 */
export function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined
  } catch {
    return undefined
  }
}
