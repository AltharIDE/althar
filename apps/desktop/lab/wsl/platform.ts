/*
 * The lab is Althar on a PC with Windows: the kit reads the system once, as
 * it loads, so this runs before anything imports it.
 */
;(window as unknown as { althar: { platform: string } }).althar = { platform: 'win32' }
