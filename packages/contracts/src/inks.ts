import { ProjectInk } from './Api'

/*
 * A new project's ink, the colour its mark is drawn in. The runtime picks
 * it when a project is made without one; the window shows the same pick
 * before the project is made, so the person can keep it or choose another.
 */

/**
 * The first ink, from where the seed (the project's id) points, that no
 * other project has, while one is free. It is chosen once, when the project
 * is made, and kept: worked out again, it would change as other projects
 * come and go.
 */
export const inkFor = (seed: string, taken: ReadonlyArray<string>): ProjectInk => {
  const inks = ProjectInk.literals
  // FNV-1a: the same seed always starts at the same ink.
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193) >>> 0
  const start = hash % inks.length
  const free = [...inks.slice(start), ...inks.slice(0, start)].find((ink) => !taken.includes(ink))
  return free ?? inks[start] ?? 'clay'
}
