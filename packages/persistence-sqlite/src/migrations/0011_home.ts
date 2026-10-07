import { at } from './0001_initial/columns'

/*
 * The home: the window you come back to.
 *
 * A project has an ink, the colour its mark is drawn in. It is chosen once,
 * when the project is made, and kept, so the mark stays the one you learnt
 * through renames and on every device. The projects made before get one each,
 * in the order they were made, so no two of the first eight share one.
 *
 * A device remembers when the person last left the home on it, so the home
 * can say what the loop did since.
 */
const INKS = ['clay', 'ochre', 'olive', 'moss', 'teal', 'slate', 'rose', 'umber'] as const

export const statements: ReadonlyArray<string> = [
  `ALTER TABLE projects ADD COLUMN ink TEXT NOT NULL DEFAULT 'clay' CHECK (ink IN (${INKS.map((ink) => `'${ink}'`).join(', ')}))`,
  `UPDATE projects SET ink = (
    SELECT json_extract('${JSON.stringify(INKS)}', '$[' || ((made.n - 1) % ${INKS.length}) || ']')
    FROM (SELECT id, row_number() OVER (ORDER BY created_at, rowid) AS n FROM projects) made WHERE made.id = projects.id)`,
  `ALTER TABLE devices ADD COLUMN ${at('home_looked_at', { nullable: true })}`,
]
