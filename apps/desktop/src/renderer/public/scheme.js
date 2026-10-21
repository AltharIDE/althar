// Light or dark before anything paints. The window's scheme is the one Electron's nativeTheme gives, which the main
// process sets from Settings › Appearance; this runs in the page's head, ahead of its styles' first frame, so the window
// never shows the other scheme first. The app keeps it as the scheme changes (shared/scheme.ts).
document.documentElement.dataset.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
