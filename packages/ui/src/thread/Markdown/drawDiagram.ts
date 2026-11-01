import DOMPurify from 'dompurify'
import mermaid, { type MermaidConfig } from 'mermaid'

/*
 * A mermaid diagram drawn as SVG, offline. This module is what pulls mermaid
 * in, so it is only ever imported lazily (drawing.ts), the first time a
 * diagram shows: the window's start and a thread without diagrams don't pay
 * for it.
 *
 * The text comes from agents and repositories, so it is drawn as mermaid's
 * strict level draws it (no click handlers, no HTML labels), and a diagram
 * can't change that, nor the theme, from inside itself. What comes out is
 * sanitized again here: no script, no event handlers, no link but to a part
 * of the same drawing, and no CSS that would fetch anything, so a diagram
 * reaches nothing beyond the window even where no Content-Security-Policy
 * stands guard.
 */

/** The kit's colours a diagram is drawn in, read from the tokens as they are showing. */
export interface DiagramColours {
  dark: boolean
  font: string
  /** The sheet it sits on. */
  paper: string
  /** A shape's fill, its edge, and the words in it. */
  fill: string
  edge: string
  ink: string
  /** Secondary words, and the lines between shapes. */
  ink2: string
  line: string
  /** A second and third fill, for clusters, alternating rows and notes. */
  fill2: string
  fill3: string
}

export interface Drawn {
  svg: string
  /** Its own size, in CSS pixels. */
  width: number
  height: number
}

/** What a diagram can't set for itself from a directive or its front matter, beyond mermaid's own. */
const SECURE = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'suppressErrorRendering',
  'maxEdges',
  'htmlLabels',
  'theme',
  'themeVariables',
  'themeCSS',
  'fontFamily',
  'altFontFamily',
  'darkMode',
  'look',
  'legacyMathML',
  'forceLegacyMathML',
]

const config = (c: DiagramColours): MermaidConfig => ({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  suppressErrorRendering: true,
  secure: SECURE,
  theme: 'base',
  /* flat, as the kit draws: mermaid's newer look casts a shadow under every shape */
  look: 'classic',
  darkMode: c.dark,
  fontFamily: c.font,
  /* a sequence's words at a flowchart's size */
  sequence: { actorFontSize: 13, messageFontSize: 13, noteFontSize: 13 },
  themeVariables: {
    darkMode: c.dark,
    fontFamily: c.font,
    fontSize: '13px',
    background: c.paper,
    mainBkg: c.fill,
    primaryColor: c.fill,
    primaryBorderColor: c.edge,
    primaryTextColor: c.ink,
    secondaryColor: c.fill2,
    secondaryBorderColor: c.edge,
    secondaryTextColor: c.ink,
    tertiaryColor: c.fill3,
    tertiaryBorderColor: c.edge,
    tertiaryTextColor: c.ink,
    lineColor: c.line,
    textColor: c.ink,
    titleColor: c.ink,
    edgeLabelBackground: c.paper,
    clusterBkg: c.fill3,
    clusterBorder: c.edge,
    noteBkgColor: c.fill2,
    noteBorderColor: c.edge,
    noteTextColor: c.ink,
    actorBkg: c.fill,
    actorBorder: c.edge,
    actorTextColor: c.ink,
    actorLineColor: c.line,
    signalColor: c.ink2,
    signalTextColor: c.ink,
    labelBoxBkgColor: c.fill,
    labelBoxBorderColor: c.edge,
    labelTextColor: c.ink,
    loopTextColor: c.ink,
    activationBkgColor: c.fill2,
    activationBorderColor: c.edge,
    sequenceNumberColor: c.paper,
  },
})

/* CSS that would fetch: an @import, a url() to anything but a part of the drawing, an image-set; a backslash could spell either out in escapes */
const offline = (css: string) =>
  css
    .replace(/\\/g, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, 'none')
    .replace(/image-set\([^)]*\)/gi, 'none')

const purify = DOMPurify(window)
purify.addHook('afterSanitizeAttributes', (node) => {
  for (const name of ['href', 'xlink:href']) {
    const value = node.getAttribute(name)
    if (value !== null && !value.trim().startsWith('#')) node.removeAttribute(name)
  }
  /* style, and fill, filter, mask and the rest, where a url() can stand as well */
  for (const { name, value } of node.attributes) {
    if (/url|image-set|\\/i.test(value)) node.setAttribute(name, offline(value))
  }
})
purify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName === 'style') node.textContent = offline(node.textContent ?? '')
})

/** The drawing as mermaid made it, with nothing that runs or fetches, at its own size. */
export const clean = (svg: string): Drawn => {
  const fragment = purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true, html: true },
    ADD_TAGS: ['foreignObject', 'style'],
    FORBID_TAGS: [
      'image',
      'img',
      'a',
      'animate',
      'set',
      'animateMotion',
      'animateTransform',
      'iframe',
      'object',
      'embed',
      'link',
      'meta',
      'video',
      'audio',
      'source',
      'picture',
      'form',
      'input',
      'button',
    ],
    FORBID_ATTR: ['src', 'srcset', 'background', 'poster', 'action', 'formaction'],
    RETURN_DOM_FRAGMENT: true,
  })
  const root = fragment.firstElementChild
  if (!(root instanceof SVGSVGElement)) throw new Error('Mermaid drew nothing')
  /* at its own size, scrolling sideways where it is wider than the thread, rather than shrunk until its words can't be read */
  const box = root
    .getAttribute('viewBox')
    ?.split(/[\s,]+/)
    .map(Number)
  const width = Math.ceil(box?.[2] ?? 0) || 320
  const height = Math.ceil(box?.[3] ?? 0) || 160
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  root.style.removeProperty('max-width')
  return { svg: root.outerHTML, width, height }
}

let count = 0
/* mermaid's configuration is global, so one diagram at a time, each with its own */
let queue: Promise<unknown> = Promise.resolve()

/** The diagram the source says, drawn in these colours; mermaid's error where it can't be. */
export function drawDiagram(source: string, colours: DiagramColours): Promise<Drawn> {
  const id = `althar-diagram-${++count}`
  const drawn = queue.then(async () => {
    mermaid.initialize(config(colours))
    try {
      const { svg } = await mermaid.render(id, source)
      return clean(svg)
    } finally {
      /* where it failed, mermaid can leave its scratch element in the page */
      document.getElementById(`d${id}`)?.remove()
      document.getElementById(id)?.remove()
    }
  })
  queue = drawn.catch(() => undefined)
  return drawn
}
