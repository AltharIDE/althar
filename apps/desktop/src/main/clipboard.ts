/*
 * A token on the clipboard, for connecting a code host or tracker: the
 * window asks while a step waits for one, as the person comes back from the
 * page that made it. Only text that looks like a token goes back, a line of
 * one word starting as some service's tokens do; whatever else the person
 * copied never reaches the page.
 */

/** What the services' tokens start with: GitHub's fine-grained and classic, GitLab's, Atlassian's, Trello's and Linear's keys. */
export const TOKEN_PREFIXES: ReadonlyArray<string> = ['github_pat_', 'ghp_', 'glpat-', 'ATATT', 'ATTA', 'lin_api_']

/** The text, where it is a token; null for anything else. */
export const tokenIn = (text: string): string | null => {
  const token = text.trim()
  return /^\S{20,400}$/.test(token) && TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix)) ? token : null
}
