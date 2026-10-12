declare global {
  interface ImportMetaEnv {
    /** The day the site was built, YYYY-MM-DD, in UTC: what a prerendered page says is still ahead (vite.config.ts). */
    readonly BUILT_ON: string
  }
}

export {}
