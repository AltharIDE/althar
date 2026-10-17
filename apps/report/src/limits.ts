/*
 * How many reports may come in a minute: per install and per IP address,
 * each counted by one of Cloudflare's Rate Limiting bindings (set in
 * wrangler.jsonc). The handler sees only `Limiter`, so tests count with a
 * fake. Cloudflare counts per location and lets a few extra through; the
 * limit keeps a stuck loop or a script from flooding the tracker, it isn't
 * a quota.
 */

export interface Limiter {
  /** Counts one more for `key`, and says whether it is still within the limit. */
  allows(key: string): Promise<boolean>
}

/** A Rate Limiting binding, as the Workers runtime hands it over in `env`. */
export interface RateLimitBinding {
  limit(options: { readonly key: string }): Promise<{ readonly success: boolean }>
}

export const isRateLimitBinding = (value: unknown): value is RateLimitBinding =>
  typeof value === 'object' && value !== null && 'limit' in value && typeof value.limit === 'function'

export const limiterOf = (binding: RateLimitBinding): Limiter => ({
  allows: async (key) => (await binding.limit({ key })).success,
})
