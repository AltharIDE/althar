import type { ProjectInk } from '@althar/contracts'

/*
 * The kit's palette (packages/ui/src/styles/tokens.css and dark.css), as a
 * phone needs it: warm paper and ink, cobalt for the work Althar is running,
 * violet for exactly one thing, a person's call. Kept by the kit's names so a
 * change there is easy to carry here.
 */

export type Palette = {
  readonly scheme: 'light' | 'dark'
  /** The page: the primary surface. */
  readonly page: string
  /** Raised: cards, sheets, the tab bar. */
  readonly raised: string
  /** The lightest: fields, and what sits on a raised sheet. */
  readonly paper: string
  /** Pressed or chosen. */
  readonly pressed: string
  /** A recess in a card: a pull request's row, a command. */
  readonly well: string
  readonly chrome: string
  readonly t1: string
  readonly t2: string
  readonly t3: string
  readonly t4: string
  readonly line: string
  readonly line2: string
  readonly line3: string
  /** Violet: this requires a person. */
  readonly signal: string
  readonly signalDim: string
  readonly signalLine: string
  readonly signalPaper: string
  readonly signalFill: string
  readonly onSignal: string
  /** Cobalt: Althar's own colour, the work it is running right now. */
  readonly live: string
  readonly liveDim: string
  readonly warm: string
  readonly danger: string
  readonly dangerDim: string
  readonly ok: string
  readonly okDim: string
  readonly inkFill: string
  readonly onInk: string
  readonly shadow: string
  readonly diffAdd: string
  readonly diffDel: string
  readonly diffAddStrong: string
  readonly diffDelStrong: string
  readonly projects: Readonly<Record<ProjectInk, string>>
}

export const light: Palette = {
  scheme: 'light',
  page: '#f4f2ec',
  raised: '#fcfbf8',
  paper: '#ffffff',
  pressed: '#e7e3da',
  well: '#f4f2ec',
  chrome: '#ebe8e0',
  t1: '#141417',
  t2: '#45454c',
  t3: '#6f6f77',
  t4: '#9a99a0',
  line: 'rgba(20, 20, 28, 0.07)',
  line2: 'rgba(20, 20, 28, 0.11)',
  line3: 'rgba(20, 20, 28, 0.18)',
  signal: '#7a3ff0',
  signalDim: 'rgba(122, 63, 240, 0.1)',
  signalLine: 'rgba(122, 63, 240, 0.32)',
  signalPaper: '#f6f1ff',
  signalFill: '#7a3ff0',
  onSignal: '#ffffff',
  live: '#2b3bff',
  liveDim: 'rgba(43, 59, 255, 0.1)',
  warm: '#c9822f',
  danger: '#c4402f',
  dangerDim: 'rgba(196, 64, 47, 0.07)',
  ok: '#2e8c46',
  okDim: 'rgba(46, 140, 70, 0.1)',
  inkFill: '#141417',
  onInk: '#ffffff',
  shadow: 'rgba(60, 50, 30, 0.14)',
  diffAdd: 'rgba(46, 140, 70, 0.09)',
  diffDel: 'rgba(196, 64, 47, 0.08)',
  diffAddStrong: 'rgba(46, 140, 70, 0.22)',
  diffDelStrong: 'rgba(196, 64, 47, 0.2)',
  projects: {
    clay: '#b4532a',
    ochre: '#8a6d2f',
    olive: '#6b7330',
    moss: '#4f7a4a',
    teal: '#2f6f7a',
    slate: '#56616e',
    rose: '#a24d5c',
    umber: '#6e4b3a',
  },
}

export const dark: Palette = {
  scheme: 'dark',
  page: '#1c1a17',
  raised: '#25231f',
  paper: '#2d2a26',
  pressed: '#33302b',
  well: '#1c1a17',
  chrome: '#161513',
  t1: '#efeae1',
  t2: '#bcb5a9',
  t3: '#aca699',
  t4: '#6e695f',
  line: 'rgba(255, 240, 215, 0.075)',
  line2: 'rgba(255, 240, 215, 0.115)',
  line3: 'rgba(255, 240, 215, 0.19)',
  signal: '#a68aff',
  signalDim: 'rgba(166, 138, 255, 0.13)',
  signalLine: 'rgba(166, 138, 255, 0.42)',
  signalPaper: '#2c2832',
  signalFill: '#7350ec',
  onSignal: '#ffffff',
  live: '#8a95ff',
  liveDim: 'rgba(138, 149, 255, 0.15)',
  warm: '#e2a457',
  danger: '#f2816f',
  dangerDim: 'rgba(242, 129, 111, 0.11)',
  ok: '#5fc47e',
  okDim: 'rgba(95, 196, 126, 0.12)',
  inkFill: '#efeae1',
  onInk: '#141417',
  shadow: 'rgba(0, 0, 0, 0.4)',
  diffAdd: 'rgba(95, 196, 126, 0.1)',
  diffDel: 'rgba(242, 129, 111, 0.1)',
  diffAddStrong: 'rgba(95, 196, 126, 0.24)',
  diffDelStrong: 'rgba(242, 129, 111, 0.22)',
  projects: {
    clay: '#d4774f',
    ochre: '#c3a259',
    olive: '#a3ab5a',
    moss: '#82b07c',
    teal: '#5fa8b4',
    slate: '#95a0ae',
    rose: '#d27d8e',
    umber: '#b48b77',
  },
}

/** Faces, as loaded in the root layout. */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const

/** The type scale, for a phone: larger than the desktop's 13px body, as a thumb reads at arm's length. */
export const type = {
  largeTitle: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  title: { fontFamily: fonts.semibold, fontSize: 22, lineHeight: 28, letterSpacing: -0.35 },
  headline: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, letterSpacing: -0.15 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, letterSpacing: -0.1 },
  sub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  subMedium: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.1 },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 0.4, textTransform: 'uppercase' as const },
  mono: { fontFamily: fonts.mono, fontSize: 12.5, lineHeight: 18 },
  monoSmall: { fontFamily: fonts.mono, fontSize: 11.5, lineHeight: 16 },
} as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const
