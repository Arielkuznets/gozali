type Attrs = Record<string, string | number | undefined>;

const round = (value: number) => String(Math.round(value * 100) / 100);

/** Builds one SVG element as markup; undefined attributes are left out. */
export function el(tag: string, attrs: Attrs, ...children: string[]): string {
  const attributes = Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${typeof value === 'number' ? round(value) : value}"`)
    .join('');
  const content = children.join('');
  return content ? `<${tag}${attributes}>${content}</${tag}>` : `<${tag}${attributes}/>`;
}

export const g = (attrs: Attrs, ...children: string[]) => el('g', attrs, ...children);
export const path = (d: string, attrs: Attrs = {}) => el('path', { d, ...attrs });
export const circle = (cx: number, cy: number, r: number, attrs: Attrs = {}) => el('circle', { cx, cy, r, ...attrs });
export const ellipse = (cx: number, cy: number, rx: number, ry: number, attrs: Attrs = {}) =>
  el('ellipse', { cx, cy, rx, ry, ...attrs });
export const rect = (x: number, y: number, width: number, height: number, attrs: Attrs = {}) =>
  el('rect', { x, y, width, height, ...attrs });

/** Stroke attributes for line art with soft ends. */
export const line = (color: string, width: number): Attrs => ({
  fill: 'none',
  stroke: color,
  'stroke-width': width,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
});

/** Scales children around a point. */
export const scaleAround = (x: number, y: number, sx: number, sy = sx) =>
  `translate(${round(x)} ${round(y)}) scale(${round(sx)} ${round(sy)}) translate(${round(-x)} ${round(-y)})`;
