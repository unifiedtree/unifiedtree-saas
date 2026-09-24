// Chart geometry helpers shared by the design components (ported from the design export).
export const DashChart = {
  smooth(pts: number[][], H: number): string {
    if (!pts || !pts.length) return ''
    const f = (n: number) => n.toFixed(2)
    const cl = (v: number) => Math.max(0, Math.min(H, v))
    let d = 'M' + f(pts[0][0]) + ',' + f(pts[0][1])
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2
      d += ' C' + f(p1[0] + (p2[0] - p0[0]) / 6) + ',' + f(cl(p1[1] + (p2[1] - p0[1]) / 6)) + ' ' + f(p2[0] - (p3[0] - p1[0]) / 6) + ',' + f(cl(p2[1] - (p3[1] - p1[1]) / 6)) + ' ' + f(p2[0]) + ',' + f(p2[1])
    }
    return d
  },
}
