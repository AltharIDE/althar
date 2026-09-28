import { create } from 'storybook/theming'

/*
 * Storybook in Charrette's own materials: the window's chrome around the
 * page, ink type, and cobalt, Charrette's colour, for where you are. Values
 * mirror src/styles/tokens.css; the manager cannot read CSS variables.
 */
/* The favicon's tile: the Logo's ruler section in paper on cobalt (src/foundations/Logo). */
const mark = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style="flex:none"><rect width="24" height="24" rx="5.25" fill="#2b3bff"/><path fill="#fcfbf8" fill-rule="evenodd" transform="translate(2.4 2.4) scale(.8)" d="M12.42 5.53A15.36 15.36 0 0 0 19.89 18.47L19.47 19.2A15.36 15.36 0 0 0 4.53 19.2L4.11 18.47A15.36 15.36 0 0 0 11.58 5.53ZM10.2 14.4a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0Z"/></svg>`

export const theme = create({
  base: 'light',
  brandTitle: `<span style="display:inline-flex;align-items:center;gap:9px;font:600 14px/1 'Inter Variable',Inter,system-ui,sans-serif;letter-spacing:-0.01em;color:#141417">${mark}Charrette<span style="font:500 10.5px/1 'JetBrains Mono Variable',ui-monospace,monospace;letter-spacing:0.06em;text-transform:uppercase;color:#6f6f77">ui</span></span>`,
  brandTarget: '_self',

  colorPrimary: '#141417',
  colorSecondary: '#2b3bff',

  appBg: '#ebe8e0',
  appContentBg: '#fcfbf8',
  appPreviewBg: '#f4f2ec',
  appHoverBg: '#e7e3da',
  appBorderColor: 'rgba(20, 20, 28, 0.11)',
  appBorderRadius: 10,

  fontBase: "'Inter Variable', Inter, system-ui, sans-serif",
  fontCode: "'JetBrains Mono Variable', ui-monospace, monospace",

  textColor: '#141417',
  textInverseColor: '#fcfbf8',
  textMutedColor: '#6f6f77',

  barTextColor: '#45454c',
  barHoverColor: '#141417',
  barSelectedColor: '#2b3bff',
  barBg: '#fcfbf8',

  buttonBg: '#fcfbf8',
  buttonBorder: 'rgba(20, 20, 28, 0.11)',
  booleanBg: '#e7e3da',
  booleanSelectedBg: '#fcfbf8',

  inputBg: '#fcfbf8',
  inputBorder: 'rgba(20, 20, 28, 0.11)',
  inputTextColor: '#141417',
  inputBorderRadius: 6,
})
