import { join } from 'node:path'

/*
 * Where the runtime finds the default skill catalog: in a packaged app, the
 * copy scripts/package.ts puts beside the app's other resources; in dev, the
 * one packages/skills builds. `main` is the folder the main process's bundle
 * runs from (dist/main).
 */

export const skillsCatalog = (main: string, packaged: boolean): string =>
  packaged ? join(main, '../../resources/skills-catalog') : join(main, '../../../../packages/skills/catalog')
