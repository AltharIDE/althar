/** An arc's path round (cx, cy) at radius r, from one angle to another in degrees, clockwise, 0 at the top. */
export function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const at = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180
    return `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`
  }
  return `M${at(from)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${at(to)}`
}
