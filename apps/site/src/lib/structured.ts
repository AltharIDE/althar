import { LINKS } from '../content/facts'
import { PAGE_META, type PagePath } from '../content/pages'
import { SHIFTS } from '../content/shifts'
import { newestFirst } from '../shifts/group'
import { urlOf } from './meta'

/*
 * What each page is, in schema.org terms, for search engines and AI
 * assistants: the product, the shifts with their sources, the thesis. Only
 * what the site itself says: the app's description is the home page's, its
 * systems are the ones the page names, and each shift is its line, its day
 * and its source. Pure, so the prerender and the tests share it.
 */

const LICENCE = 'https://www.apache.org/licenses/LICENSE-2.0'

const CONTEXT = 'https://schema.org'

/** The site, the organisation and the app, each once, for the others to point at by @id. */
const ids = (origin: string) => ({
  site: urlOf(origin, '/#website'),
  org: urlOf(origin, '/#organization'),
  app: urlOf(origin, '/#app'),
})

/** Althar, then the page. */
const breadcrumbs = (origin: string, path: PagePath) => ({
  '@context': CONTEXT,
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Althar', item: urlOf(origin, '/') },
    { '@type': 'ListItem', position: 2, name: PAGE_META[path].name, item: urlOf(origin, path) },
  ],
})

function home(origin: string): object[] {
  const id = ids(origin)
  const page = PAGE_META['/']
  return [
    { '@context': CONTEXT, '@type': 'WebSite', '@id': id.site, name: 'Althar', url: urlOf(origin, '/'), publisher: { '@id': id.org } },
    {
      '@context': CONTEXT,
      '@type': 'Organization',
      '@id': id.org,
      name: 'Althar',
      url: urlOf(origin, '/'),
      logo: urlOf(origin, '/logo.png'),
      sameAs: [LINKS.org],
    },
    {
      '@context': CONTEXT,
      '@type': 'SoftwareApplication',
      '@id': id.app,
      name: 'Althar',
      description: page.description,
      url: urlOf(origin, '/'),
      image: urlOf(origin, page.image),
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS, Windows, Linux',
      license: LICENCE,
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      publisher: { '@id': id.org },
      sameAs: [LINKS.repo],
    },
    {
      '@context': CONTEXT,
      '@type': 'SoftwareSourceCode',
      name: 'Althar',
      codeRepository: LINKS.repo,
      license: LICENCE,
      targetProduct: { '@id': id.app },
    },
  ]
}

function shifts(origin: string): object[] {
  const page = PAGE_META['/shifts']
  const url = urlOf(origin, page.path)
  const all = newestFirst(SHIFTS)
  return [
    {
      '@context': CONTEXT,
      '@type': 'CollectionPage',
      '@id': url,
      url,
      name: page.name,
      description: page.description,
      image: urlOf(origin, page.image),
      dateModified: all[0]?.date,
      isPartOf: { '@id': ids(origin).site },
      mainEntity: {
        '@type': 'ItemList',
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        numberOfItems: all.length,
        itemListElement: all.map((shift, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'CreativeWork',
            '@id': `${url}#${shift.id}`,
            url: `${url}#${shift.id}`,
            name: shift.title,
            description: shift.what,
            temporalCoverage: shift.date,
            about: { '@type': 'Organization', name: shift.who },
            citation: { '@type': 'CreativeWork', name: shift.source.name, url: shift.source.url },
          },
        })),
      },
    },
    breadcrumbs(origin, '/shifts'),
  ]
}

function thesis(origin: string): object[] {
  const page = PAGE_META['/thesis']
  const url = urlOf(origin, page.path)
  const org = { '@id': ids(origin).org }
  return [
    {
      '@context': CONTEXT,
      '@type': 'Article',
      '@id': url,
      url,
      mainEntityOfPage: url,
      headline: page.name,
      description: page.description,
      image: urlOf(origin, page.image),
      inLanguage: 'en',
      author: org,
      publisher: org,
      isPartOf: { '@id': ids(origin).site },
    },
    breadcrumbs(origin, '/thesis'),
  ]
}

function wallpaper(origin: string): object[] {
  const page = PAGE_META['/wallpaper']
  const url = urlOf(origin, page.path)
  return [
    {
      '@context': CONTEXT,
      '@type': 'WebPage',
      '@id': url,
      url,
      name: page.name,
      description: page.description,
      image: urlOf(origin, page.image),
      isPartOf: { '@id': ids(origin).site },
    },
    breadcrumbs(origin, '/wallpaper'),
  ]
}

const BY_PATH: Partial<Record<PagePath, (origin: string) => object[]>> = {
  '/': home,
  '/shifts': shifts,
  '/thesis': thesis,
  '/wallpaper': wallpaper,
}

/** A page's schema.org data, with absolute addresses from `origin`. None for a page kept out of search. */
export const structuredData = (path: PagePath, origin: string): object[] => (PAGE_META[path].index ? (BY_PATH[path]?.(origin) ?? []) : [])
