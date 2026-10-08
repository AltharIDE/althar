/*
 * The banners: one printed look (banners/printed.html) at each size a place
 * asks for. `scale` is how many times that size it is drawn: 2 for the ones
 * people see large and sharp, 1 where a place wants the exact size and caps
 * the weight (GitHub's social preview, under 1 MB).
 */

export type BannerLayout = 'wide' | 'strip' | 'centre' | 'avatar'

export interface Banner {
  /** The folder of export/ it goes to. */
  folder: 'banner' | 'avatar'
  file: string
  width: number
  height: number
  layout: BannerLayout
  scale: number
  /** Where it is used, for the README table. */
  use: string
  /** Written at these widths instead, as `<file>-<width>.png`, each made from the one drawing. */
  sizes?: readonly number[]
}

export const BANNERS: readonly Banner[] = [
  { folder: 'banner', file: 'readme-header', width: 1280, height: 400, layout: 'wide', scale: 2, use: "The repository README's header" },
  {
    folder: 'banner',
    file: 'github-social-preview',
    width: 1280,
    height: 640,
    layout: 'wide',
    scale: 1,
    use: 'GitHub social preview: repository settings, link cards',
  },
  {
    folder: 'banner',
    file: 'og-default',
    width: 1200,
    height: 630,
    layout: 'wide',
    scale: 1,
    use: 'Open Graph and Twitter card for any page without its own',
  },
  { folder: 'banner', file: 'x-header', width: 1500, height: 500, layout: 'wide', scale: 1, use: 'X profile header' },
  {
    folder: 'banner',
    file: 'linkedin-cover',
    width: 1128,
    height: 191,
    layout: 'strip',
    scale: 2,
    use: 'LinkedIn company page cover; the logo covers the lower left',
  },
  {
    folder: 'banner',
    file: 'youtube-banner',
    width: 2560,
    height: 1440,
    layout: 'centre',
    scale: 1,
    use: 'YouTube channel art; the centre 1546 × 423 shows on every screen',
  },
  {
    folder: 'avatar',
    file: 'avatar-printed',
    width: 1024,
    height: 1024,
    layout: 'avatar',
    scale: 1,
    sizes: [1024, 400, 128],
    use: "An avatar in the README's printed look: the mark as a halftone on paper stock",
  },
]
