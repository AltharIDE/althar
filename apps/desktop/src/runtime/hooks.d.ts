/** Whether the build keeps the end-to-end tests' hooks: true, except in a packaged build (`--mode package`). */
declare const __ALTHAR_TEST_HOOKS__: boolean
/** PostHog's project key and host for anonymous usage data, given to a packaged build alone; empty in every other build, which sends nothing. */
declare const __ALTHAR_USAGE__: { readonly key: string; readonly host: string }
