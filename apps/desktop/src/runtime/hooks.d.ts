/** Whether the build keeps the end-to-end tests' hooks: true, except in a packaged build (`--mode package`). */
declare const __ALTHAR_TEST_HOOKS__: boolean

/** Althar's reports service, the Worker in apps/report, as the build was given it (ALTHAR_REPORT_URL); empty for none. */
declare const __ALTHAR_REPORT_URL__: string

/** Where a report goes by mail when there is no Worker (ALTHAR_REPORT_EMAIL at build time). */
declare const __ALTHAR_REPORT_EMAIL__: string
