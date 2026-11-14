/** Browser decoding keeps GIF work off the UI thread. Only still, bounded posters are retained here. */
const posters = new Map<string, Promise<Blob | null>>()
const MOST = 16
const EDGE = 1120

export const recordingPoster = (src: string, width?: number, height?: number): Promise<Blob | null> => {
  const known = posters.get(src)
  if (known !== undefined) return known
  const pending = (async () => {
    const response = await fetch(src)
    if (!response.ok) return null
    const bytes = await response.blob()
    const scale = Math.min(1, EDGE / (width || EDGE), EDGE / (height || EDGE))
    // createImageBitmap takes an animated image's first frame; it never starts its animation.
    const image = await createImageBitmap(
      bytes,
      width === undefined || height === undefined
        ? {}
        : { resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)) },
    )
    try {
      const ratio = Math.min(1, EDGE / image.width, EDGE / image.height)
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * ratio)), Math.max(1, Math.round(image.height * ratio)))
      const context = canvas.getContext('2d')
      if (context === null) return null
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      return await canvas.convertToBlob({ type: 'image/png' })
    } finally {
      image.close()
    }
  })().catch(() => null)
  posters.set(src, pending)
  void pending.then((blob) => {
    if (blob === null && posters.get(src) === pending) posters.delete(src)
  })
  if (posters.size > MOST) posters.delete(posters.keys().next().value ?? '')
  return pending
}
