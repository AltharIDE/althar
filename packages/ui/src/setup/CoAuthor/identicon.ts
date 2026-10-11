/*
 * A face the way a code host draws one for an account with no picture of its
 * own: five cells by five, the left half mirrored onto the right, which cells
 * are filled read from the name. Not the host's own drawing of that account,
 * which it makes from an id Althar doesn't know: a face of the same kind.
 */

/** Which of the 25 cells are filled, row by row, for a name. */
export const identicon = (name: string): ReadonlyArray<ReadonlyArray<boolean>> => {
  // FNV-1a, so each name has its own face and keeps it.
  let hash = 0x811c9dc5
  for (const char of name) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return Array.from({ length: 5 }, (_, row) => {
    const half = Array.from({ length: 3 }, (_, column) => ((hash >>> (row * 3 + column)) & 1) === 1)
    return [half[0] ?? false, half[1] ?? false, half[2] ?? false, half[1] ?? false, half[0] ?? false]
  })
}
