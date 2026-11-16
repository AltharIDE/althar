/** A host a person explicitly selected for sign-in. No paths, credentials, query strings or insecure redirects. */
export const signInHost = (input: string): string | null => {
  const value = input.trim()
  if (value === '') return null
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      !url.hostname.includes('.') ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    )
      return null
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}
