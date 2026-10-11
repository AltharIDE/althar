import { createContext, useContext } from 'react'

/** The page's path, as App was given it: the same in the prerender and in the browser, unlike `window.location`. */
export const Pathname = createContext('/')

/** Whether `href` is the page being read, ignoring a trailing slash. */
export const useHere = () => {
  const path = useContext(Pathname).replace(/\/+$/, '') || '/'
  return (href: string) => path === href
}
