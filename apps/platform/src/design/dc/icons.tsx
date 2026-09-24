// Icons used by the Claude Design prototype (Lucide paths, ISC). Ported
// verbatim from the design export so every icon matches the design exactly.
import { createElement, type CSSProperties, type ComponentType } from 'react'

type Node = [string, Record<string, any>]
const P = (d: string): Node => ['path', { d }]
const I: Record<string, Node[]> = {
alertTriangle:[P('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'),P('M12 9v4'),P('M12 17h.01')],
calculator:[['rect',{width:16,height:20,x:4,y:2,rx:2}],['line',{x1:8,x2:16,y1:6,y2:6}],['line',{x1:16,x2:16,y1:14,y2:18}],P('M16 10h.01'),P('M12 10h.01'),P('M8 10h.01'),P('M12 14h.01'),P('M8 14h.01'),P('M12 18h.01'),P('M8 18h.01')],
banknote:[['rect',{width:20,height:12,x:2,y:6,rx:2}],['circle',{cx:12,cy:12,r:2}],P('M6 12h.01M18 12h.01')],
workflow:[['rect',{width:8,height:8,x:3,y:3,rx:2}],P('M7 11v4a2 2 0 0 0 2 2h4'),['rect',{width:8,height:8,x:13,y:13,rx:2}]],
filePen:[P('M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5'),P('M14 2v4a2 2 0 0 0 2 2h4'),P('M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z')],
users:[P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'),['circle',{cx:9,cy:7,r:4}],P('M22 21v-2a4 4 0 0 0-3-3.87'),P('M16 3.13a4 4 0 0 1 0 7.75')],
userCheck:[P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'),['circle',{cx:9,cy:7,r:4}],['polyline',{points:'16 11 18 13 22 9'}]],
userMinus:[P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'),['circle',{cx:9,cy:7,r:4}],['line',{x1:22,x2:16,y1:11,y2:11}]],
userX:[P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'),['circle',{cx:9,cy:7,r:4}],['line',{x1:17,x2:22,y1:8,y2:13}],['line',{x1:22,x2:17,y1:8,y2:13}]],
userPlus:[P('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'),['circle',{cx:9,cy:7,r:4}],['line',{x1:19,x2:19,y1:8,y2:14}],['line',{x1:22,x2:16,y1:11,y2:11}]],
alert:[['circle',{cx:12,cy:12,r:10}],['line',{x1:12,x2:12,y1:8,y2:12}],['line',{x1:12,x2:12.01,y1:16,y2:16}]],
help:[['circle',{cx:12,cy:12,r:10}],P('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'),P('M12 17h.01')],
bulb:[P('M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'),P('M9 18h6'),P('M10 22h4')],
home:[P('M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8'),P('M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z')],
download:[P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'),['polyline',{points:'7 10 12 15 17 10'}],['line',{x1:12,x2:12,y1:15,y2:3}]],
plus:[P('M5 12h14'),P('M12 5v14')],
clock:[['circle',{cx:12,cy:12,r:10}],['polyline',{points:'12 6 12 12 16 14'}]],
briefcase:[P('M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16'),['rect',{width:20,height:14,x:2,y:6,rx:2}]],
shield:[P('M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'),P('m9 12 2 2 4-4')],
rupee:[P('M6 3h12'),P('M6 8h12'),P('m6 13 8.5 8'),P('M6 13h3'),P('M9 13c6.667 0 6.667-10 0-10')],
inbox:[['polyline',{points:'22 12 16 12 14 15 10 15 8 12 2 12'}],P('M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z')],
calendarClock:[P('M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5'),P('M16 2v4'),P('M8 2v4'),P('M3 10h5'),P('M17.5 17.5 16 16.3V14'),['circle',{cx:16,cy:16,r:6}]],
calendarPlus:[P('M8 2v4'),P('M16 2v4'),P('M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8'),P('M3 10h18'),P('M16 19h6'),P('M19 16v6')],
calendarDays:[P('M8 2v4'),P('M16 2v4'),['rect',{width:18,height:18,x:3,y:4,rx:2}],P('M3 10h18'),P('M8 14h.01'),P('M12 14h.01'),P('M16 14h.01'),P('M8 18h.01'),P('M12 18h.01'),P('M16 18h.01')],
calendar:[P('M8 2v4'),P('M16 2v4'),['rect',{width:18,height:18,x:3,y:4,rx:2}],P('M3 10h18')],
cake:[P('M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8'),P('M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1'),P('M2 21h20'),P('M7 8v3'),P('M12 8v3'),P('M17 8v3'),P('M7 4h.01'),P('M12 4h.01'),P('M17 4h.01')],
award:[P('m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526'),['circle',{cx:12,cy:8,r:6}]],
megaphone:[P('m3 11 18-5v12L3 14v-3z'),P('M11.6 16.8a3 3 0 1 1-5.8-1.6')],
arrowRight:[P('M5 12h14'),P('m12 5 7 7-7 7')],
activity:[P('M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2')],
chart:[P('M3 3v18h18'),P('M18 17V9'),P('M13 17V5'),P('M8 17v-3')],
building:[P('M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z'),P('M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2'),P('M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2'),P('M10 6h4'),P('M10 10h4'),P('M10 14h4'),P('M10 18h4')],
fileText:[P('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z'),P('M14 2v4a2 2 0 0 0 2 2h4'),P('M10 9H8'),P('M16 13H8'),P('M16 17H8')],
star:[['polygon',{points:'12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2'}]],
clipboard:[['rect',{width:8,height:4,x:8,y:2,rx:1,ry:1}],P('M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'),P('m9 14 2 2 4-4')],
circleX:[['circle',{cx:12,cy:12,r:10}],P('m15 9-6 6'),P('m9 9 6 6')],
armchair:[P('M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3'),P('M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z'),P('M5 18v2'),P('M19 18v2')],
dashboard:[['rect',{width:7,height:9,x:3,y:3,rx:1}],['rect',{width:7,height:5,x:14,y:3,rx:1}],['rect',{width:7,height:9,x:14,y:12,rx:1}],['rect',{width:7,height:5,x:3,y:16,rx:1}]],
grid:[['rect',{width:7,height:7,x:3,y:3,rx:1}],['rect',{width:7,height:7,x:14,y:3,rx:1}],['rect',{width:7,height:7,x:14,y:14,rx:1}],['rect',{width:7,height:7,x:3,y:14,rx:1}]],
database:[['ellipse',{cx:12,cy:5,rx:9,ry:3}],P('M3 5V19A9 3 0 0 0 21 19V5'),P('M3 12A9 3 0 0 0 21 12')],
creditCard:[['rect',{width:20,height:14,x:2,y:5,rx:2}],['line',{x1:2,x2:22,y1:10,y2:10}]],
receipt:[P('M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z'),P('M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8'),P('M12 17.5v-11')],
target:[['circle',{cx:12,cy:12,r:10}],['circle',{cx:12,cy:12,r:6}],['circle',{cx:12,cy:12,r:2}]],
logOut:[P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'),['polyline',{points:'16 17 21 12 16 7'}],['line',{x1:21,x2:9,y1:12,y2:12}]],
settings:[P('M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'),['circle',{cx:12,cy:12,r:3}]],
search:[['circle',{cx:11,cy:11,r:8}],P('m21 21-4.3-4.3')],
bell:[P('M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9'),P('M10.3 21a1.94 1.94 0 0 0 3.4 0')],
chevronDown:[P('m6 9 6 6 6-6')],
chevronLeft:[P('m15 18-6-6 6-6')],
chevronRight:[P('m9 18 6-6-6-6')],
menu:[['line',{x1:4,x2:20,y1:12,y2:12}],['line',{x1:4,x2:20,y1:6,y2:6}],['line',{x1:4,x2:20,y1:18,y2:18}]],
x:[P('M18 6 6 18'),P('m6 6 12 12')],
swap:[P('M8 3 4 7l4 4'),P('M4 7h16'),P('m16 21 4-4-4-4'),P('M20 17H4')],
checkCircle:[['circle',{cx:12,cy:12,r:10}],P('m9 12 2 2 4-4')],
mapPin:[P('M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0'),['circle',{cx:12,cy:10,r:3}]],
hash:[['line',{x1:4,x2:20,y1:9,y2:9}],['line',{x1:4,x2:20,y1:15,y2:15}],['line',{x1:10,x2:8,y1:3,y2:21}],['line',{x1:16,x2:14,y1:3,y2:21}]],
globe:[['circle',{cx:12,cy:12,r:10}],P('M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20'),P('M2 12h20')],
list:[['line',{x1:8,x2:21,y1:6,y2:6}],['line',{x1:8,x2:21,y1:12,y2:12}],['line',{x1:8,x2:21,y1:18,y2:18}],['line',{x1:3,x2:3.01,y1:6,y2:6}],['line',{x1:3,x2:3.01,y1:12,y2:12}],['line',{x1:3,x2:3.01,y1:18,y2:18}]],
pencil:[P('M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z'),P('m15 5 4 4')],
archive:[['rect',{width:20,height:5,x:2,y:3,rx:1}],P('M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8'),P('M10 12h4')],
lock:[['rect',{width:18,height:11,x:3,y:11,rx:2,ry:2}],P('M7 11V7a5 5 0 0 1 10 0v4')],
crosshair:[['circle',{cx:12,cy:12,r:10}],['line',{x1:22,x2:18,y1:12,y2:12}],['line',{x1:6,x2:2,y1:12,y2:12}],['line',{x1:12,x2:12,y1:6,y2:2}],['line',{x1:12,x2:12,y1:22,y2:18}]],
trendingUp:[['polyline',{points:'22 7 13.5 15.5 8.5 10.5 2 17'}],['polyline',{points:'16 7 22 7 22 13'}]],
sun:[['circle',{cx:12,cy:12,r:4}],P('M12 2v2'),P('M12 20v2'),P('m4.93 4.93 1.41 1.41'),P('m17.66 17.66 1.41 1.41'),P('M2 12h2'),P('M20 12h2'),P('m6.34 17.66-1.41 1.41'),P('m19.07 4.93-1.41 1.41')],
moon:[P('M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z')],
sunrise:[P('M12 2v8'),P('m4.93 10.93 1.41 1.41'),P('M2 18h2'),P('M20 18h2'),P('m19.07 10.93-1.41 1.41'),P('M22 22H2'),P('m8 6 4-4 4 4'),P('M16 18a4 4 0 0 0-8 0')],
sunset:[P('M12 10V2'),P('m4.93 10.93 1.41 1.41'),P('M2 18h2'),P('M20 18h2'),P('m19.07 10.93-1.41 1.41'),P('M22 22H2'),P('m16 6-4 4-4-4'),P('M16 18a4 4 0 0 0-8 0')],
timer:[['line',{x1:10,x2:14,y1:2,y2:2}],['line',{x1:12,x2:15,y1:14,y2:11}],['circle',{cx:12,cy:14,r:8}]],
scanFace:[P('M3 7V5a2 2 0 0 1 2-2h2'),P('M17 3h2a2 2 0 0 1 2 2v2'),P('M21 17v2a2 2 0 0 1-2 2h-2'),P('M7 21H5a2 2 0 0 1-2-2v-2'),P('M8 14s1.5 2 4 2 4-2 4-2'),P('M9 9h.01'),P('M15 9h.01')],
fingerprint:[P('M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4'),P('M14 13.12c0 2.38 0 6.38-1 8.88'),P('M17.29 21.02c.12-.6.43-2.3.5-3.02'),P('M2 12a10 10 0 0 1 18-6'),P('M2 16h.01'),P('M21.8 16c.2-2 .131-5.354 0-6'),P('M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2'),P('M8.65 22c.21-.66.45-1.32.57-2'),P('M9 6.8a6 6 0 0 1 9 5.2v2')],
smartphone:[['rect',{width:14,height:20,x:5,y:2,rx:2,ry:2}],P('M12 18h.01')],
pieChart:[P('M21.21 15.89A10 10 0 1 1 8 2.83'),P('M22 12A10 10 0 0 0 12 2v10z')],
calendarCheck:[P('M8 2v4'),P('M16 2v4'),['rect',{width:18,height:18,x:3,y:4,rx:2}],P('M3 10h18'),P('m9 16 2 2 4-4')],
trash:[P('M3 6h18'),P('M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6'),P('M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2')],
check:[P('M20 6 9 17l-5-5')],
info:[['circle',{cx:12,cy:12,r:10}],P('M12 16v-4'),P('M12 8h.01')],
coffee:[P('M10 2v2'),P('M14 2v2'),P('M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1'),P('M6 2v2')]
}

type IconProps = { size?: number; className?: string; style?: CSSProperties }
function svg(name: string, props?: IconProps) {
  const size = (props && props.size) || 18
  const nodes = I[name] || I.alert
  return createElement(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg', width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
      className: 'lucide ' + ((props && props.className) || ''),
      style: Object.assign({ flexShrink: 0 }, props && props.style), 'aria-hidden': 'true',
    },
    nodes.map((n, i) => createElement(n[0], Object.assign({ key: i }, n[1]))),
  )
}

const compCache: Record<string, ComponentType<IconProps>> = {}
export const dashIconComponent = (name: string): ComponentType<IconProps> =>
  compCache[name] || (compCache[name] = function DashIcon(p: IconProps) { return svg(name, p) })
export const dashIcon = (name: string, size?: number, style?: CSSProperties) =>
  createElement(dashIconComponent(name), { size: size || 18, style })

/* Tile icons: HrStatCard clones its icon at size 120 as a faint watermark — this variant renders nothing at that size. */
const tileCache: Record<string, ComponentType<IconProps>> = {}
const tileComp = (name: string) =>
  tileCache[name] || (tileCache[name] = function DashTileIcon(p: IconProps) { return (p.size || 18) > 40 ? null : svg(name, p) })
export const dashTileIcon = (name: string, size?: number) => createElement(tileComp(name), { size: size || 18 })
export const DashIcons = Object.keys(I)
