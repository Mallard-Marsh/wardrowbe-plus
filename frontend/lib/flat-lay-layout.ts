import { ITEM_ROLE } from '@/lib/generated/garment-vocabulary';

export type FlatLayFormat = 'square' | 'portrait';

/** Instagram's two feed shapes: 1:1 and 4:5. */
export const FLAT_LAY_SIZES: Record<FlatLayFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1350 },
};

export interface FlatLayEntry {
  id: string;
  type: string;
  /** Width over height of the item's picture. */
  aspect: number;
}

export interface FlatLayPlacement {
  id: string;
  /** Where the garment picture goes, in canvas pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Centre and width available for the name printed under the garment. */
  labelX: number;
  labelY: number;
  labelWidth: number;
}

const MARGIN = 0.07;
const GAP = 0.03;
const LABEL_HEIGHT = 0.05;
const COLUMN_SPLIT = 0.58;

// Roles read top to bottom the way a person is dressed. The main column holds the body of the
// outfit, the side column the pieces that sit around it.
const MAIN_ROLES = ['full_body', 'suit', 'base_top', 'mid_layer', 'bottom', 'legwear'];
const SIDE_ROLES = ['outer_layer', 'neckwear', 'accessory', 'footwear', 'socks'];

// How much of a column's height a role gets: shoes and belts take a small cell so they are not
// blown up to the size of a coat.
const ROLE_WEIGHT: Record<string, number> = {
  full_body: 2.2,
  suit: 2.2,
  outer_layer: 1.3,
  base_top: 1,
  mid_layer: 0.9,
  bottom: 1.25,
  legwear: 0.8,
  footwear: 0.7,
  socks: 0.35,
  neckwear: 0.45,
  accessory: 0.5,
};

function roleOf(type: string): string {
  return ITEM_ROLE[type] ?? 'accessory';
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function stackColumn(entries: FlatLayEntry[], column: Box, labelHeight: number, gap: number) {
  if (entries.length === 0) return [];

  const weights = entries.map((e) => ROLE_WEIGHT[roleOf(e.type)] ?? 0.5);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const free = column.height - gap * (entries.length - 1);

  let top = column.y;
  return entries.map((entry, index) => {
    const cellHeight = (free * weights[index]) / totalWeight;
    const imageBox = { width: column.width, height: Math.max(cellHeight - labelHeight, 1) };
    const scale = Math.min(imageBox.width / entry.aspect, imageBox.height);
    const height = scale;
    const width = scale * entry.aspect;

    // The picture and its name are centred together inside the cell.
    const used = height + labelHeight;
    const cellTop = top + (cellHeight - used) / 2;
    const centreX = column.x + column.width / 2;

    top += cellHeight + gap;
    return {
      id: entry.id,
      x: centreX - width / 2,
      y: cellTop,
      width,
      height,
      labelX: centreX,
      labelY: cellTop + height + labelHeight / 2,
      labelWidth: column.width,
    } satisfies FlatLayPlacement;
  });
}

/** Lays an outfit out like a stylist's flat lay: the main garments stacked down one column and
 *  the shoes, outerwear and accessories around them, each with room for its name. */
export function layoutFlatLay(entries: FlatLayEntry[], format: FlatLayFormat): FlatLayPlacement[] {
  const { width, height } = FLAT_LAY_SIZES[format];
  const margin = width * MARGIN;
  const gap = width * GAP;
  const labelHeight = width * LABEL_HEIGHT;

  const rank = (list: string[]) => (e: FlatLayEntry) => {
    const index = list.indexOf(roleOf(e.type));
    return index === -1 ? list.length : index;
  };
  const byRank = (list: string[]) => (a: FlatLayEntry, b: FlatLayEntry) =>
    rank(list)(a) - rank(list)(b);

  const main = entries.filter((e) => MAIN_ROLES.includes(roleOf(e.type))).sort(byRank(MAIN_ROLES));
  const side = entries.filter((e) => !MAIN_ROLES.includes(roleOf(e.type))).sort(byRank(SIDE_ROLES));

  const inner: Box = {
    x: margin,
    y: margin,
    width: width - margin * 2,
    height: height - margin * 2,
  };

  if (main.length === 0 || side.length === 0) {
    // One kind of piece only: two columns would leave a gap, so share them out evenly.
    const all = main.length ? main : side;
    if (all.length <= 3) return stackColumn(all, inner, labelHeight, gap);
    const half = Math.ceil(all.length / 2);
    const columnWidth = (inner.width - gap) / 2;
    return [
      ...stackColumn(all.slice(0, half), { ...inner, width: columnWidth }, labelHeight, gap),
      ...stackColumn(
        all.slice(half),
        { ...inner, x: inner.x + columnWidth + gap, width: columnWidth },
        labelHeight,
        gap,
      ),
    ];
  }

  const mainWidth = (inner.width - gap) * COLUMN_SPLIT;
  const sideWidth = inner.width - gap - mainWidth;
  return [
    ...stackColumn(main, { ...inner, width: mainWidth }, labelHeight, gap),
    ...stackColumn(
      side,
      { ...inner, x: inner.x + mainWidth + gap, width: sideWidth },
      labelHeight,
      gap,
    ),
  ];
}
