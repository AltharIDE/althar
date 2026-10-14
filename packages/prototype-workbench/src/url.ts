/*
 * Where the page stands, as its address says it: the direction shown, the
 * state, whether directions stand side by side and which, and whether the bar
 * shows. So a link, or a screenshot's address, points at one exact view:
 * ?d=B&s=pushing. The prototype's own parameters stay as they are.
 */

/** Today's key, in the address and the bar: the app as it is, where the prototype draws it. */
export const TODAY = 'today'

/** What a prototype offers, by key, in the bar's order. */
export interface Offered {
  /** Its directions, with Today first where it has one. */
  readonly directions: readonly string[]
  /** Its states; none where it shows one. */
  readonly states: readonly string[]
}

/** What the page shows. */
export interface Shown {
  readonly direction: string
  /** The state, by key; '' where the prototype has none. */
  readonly state: string
  /** Side by side: the directions shown, in the bar's order. Null shows one at a time. */
  readonly side: readonly string[] | null
  readonly bar: boolean
}

/** The key a prototype gives a direction or state, whatever case the address writes it in. */
const keyIn = (keys: readonly string[], written: string | null) =>
  written === null ? undefined : keys.find((key) => key.toLowerCase() === written.trim().toLowerCase())

/** The direction a page opens on: the prototype's first, not Today. */
export const firstOf = (offered: Offered) => offered.directions.find((key) => key !== TODAY) ?? offered.directions[0] ?? ''

/** Directions side by side, as the address lists them: all, or those it names that the prototype has, in the bar's order. */
const sideOf = (offered: Offered, written: string) => {
  const named = written.split(',').flatMap((one) => keyIn(offered.directions, one) ?? [])
  return named.length === 0 || written.trim().toLowerCase() === 'all'
    ? [...offered.directions]
    : offered.directions.filter((key) => named.includes(key))
}

/** What an address shows: what it names that the prototype has, and the defaults for the rest. */
export const read = (search: string, offered: Offered): Shown => {
  const params = new URLSearchParams(search)
  const side = params.get('side')
  return {
    direction: keyIn(offered.directions, params.get('d')) ?? firstOf(offered),
    state: keyIn(offered.states, params.get('s')) ?? offered.states[0] ?? '',
    side: side === null ? null : sideOf(offered, side),
    bar: params.get('bar') !== '0',
  }
}

/** The workbench's own parameters, in the order an address says them. */
const OWN = ['d', 's', 'side', 'bar']

/** The address for what is shown: the workbench's parameters first, always in the same order, then the prototype's own. */
export const write = (shown: Shown, offered: Offered, search = ''): string => {
  const params = new URLSearchParams({ d: shown.direction })
  if (shown.state !== '') params.set('s', shown.state)
  if (shown.side !== null) params.set('side', shown.side.length === offered.directions.length ? 'all' : shown.side.join(','))
  if (!shown.bar) params.set('bar', '0')
  for (const [name, value] of new URLSearchParams(search)) if (!OWN.includes(name)) params.append(name, value)
  // Commas read as they are: ?side=A,B rather than ?side=A%2CB.
  return `?${params.toString().replaceAll('%2C', ',')}`
}

/** What is shown, made to fit what the prototype offers now, as it changes while it is worked on. */
export const fit = (shown: Shown, offered: Offered): Shown => read(write(shown, offered), offered)
