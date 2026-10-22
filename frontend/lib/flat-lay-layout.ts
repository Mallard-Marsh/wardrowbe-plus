import { ITEM_ROLE } from '@/lib/generated/garment-vocabulary';
import { longSideCm } from '@/lib/flat-lay-sizes';

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
  /** Optional per-item size correction for a photo taken very close or far. Defaults to 1. */
  scaleMultiplier?: number;
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
// A lone small item must not be blown up: the scale is capped so a 100 cm garment fills at most
// 85% of the canvas height.
const UPGRADE_CAP = 0.85;
const CAP_REFERENCE_CM = 100;
// An earlier (preferred) arrangement is used unless a later one allows a scale more than this much
// bigger, i.e. it keeps at least 90% of the best scale.
const PREFERENCE_TOLERANCE = 0.9;

// Roles read top to bottom the way a person is dressed. The main group holds the body of the
// outfit, the side group the pieces that sit around it.
const MAIN_ROLES = ['full_body', 'suit', 'base_top', 'mid_layer', 'bottom', 'legwear'];
const SIDE_ROLES = ['outer_layer', 'neckwear', 'accessory', 'footwear', 'socks'];

function roleOf(type: string): string {
  return ITEM_ROLE[type] ?? 'accessory';
}

/** An item's size in centimetres: its longer side is the garment's real-world length. */
interface Sized {
  entry: FlatLayEntry;
  wCm: number;
  hCm: number;
}

function sizeInCm(entry: FlatLayEntry): Sized {
  const longSide = longSideCm(entry.type) * (entry.scaleMultiplier ?? 1);
  const aspect = Math.max(entry.aspect, 0.01);
  return {
    entry,
    wCm: aspect >= 1 ? longSide : longSide * aspect,
    hCm: aspect >= 1 ? longSide / aspect : longSide,
  };
}

const byRole = (order: string[]) => (a: Sized, b: Sized) =>
  order.indexOf(roleOf(a.entry.type)) - order.indexOf(roleOf(b.entry.type));

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Stacks items vertically in a column, each centred, with its name printed below it. */
function placeStack(
  items: Sized[],
  column: Box,
  scale: number,
  labelHeight: number,
  gap: number,
): FlatLayPlacement[] {
  const stackHeight =
    items.reduce((sum, s) => sum + s.hCm, 0) * scale +
    labelHeight * items.length +
    gap * (items.length - 1);

  let y = column.y + (column.height - stackHeight) / 2;
  return items.map((s) => {
    const height = s.hCm * scale;
    const width = s.wCm * scale;
    const placement = {
      id: s.entry.id,
      x: column.x + (column.width - width) / 2,
      y,
      width,
      height,
      labelX: column.x + column.width / 2,
      labelY: y + height + labelHeight / 2,
      labelWidth: column.width,
    } satisfies FlatLayPlacement;
    y += height + labelHeight + gap;
    return placement;
  });
}

/** An arrangement of the items plus the largest scale it allows. */
interface Candidate {
  scale: number;
  place: (scale: number) => FlatLayPlacement[];
}

const sumCm = (items: Sized[], pick: (s: Sized) => number) => items.reduce((sum, s) => sum + pick(s), 0);
const maxCm = (items: Sized[], pick: (s: Sized) => number) => items.reduce((max, s) => Math.max(max, pick(s)), 0);

/** Two columns side by side (the main garments, the pieces around them), centred on the canvas. */
function twoColumnCandidate(
  left: Sized[],
  right: Sized[],
  inner: Box,
  gap: number,
  labelHeight: number,
  cap: number,
): Candidate {
  const leftWidth = maxCm(left, (s) => s.wCm);
  const rightWidth = maxCm(right, (s) => s.wCm);
  const scale = Math.min(
    (inner.width - gap) / (leftWidth + rightWidth),
    (inner.height - labelHeight * left.length - gap * (left.length - 1)) / sumCm(left, (s) => s.hCm),
    (inner.height - labelHeight * right.length - gap * (right.length - 1)) / sumCm(right, (s) => s.hCm),
    cap,
  );

  return {
    scale,
    place: (s) => {
      const leftPx = leftWidth * s;
      const rightPx = rightWidth * s;
      const blockWidth = leftPx + gap + rightPx;
      const blockHeight = Math.max(
        sumCm(left, (s2) => s2.hCm) * s + labelHeight * left.length + gap * (left.length - 1),
        sumCm(right, (s2) => s2.hCm) * s + labelHeight * right.length + gap * (right.length - 1),
      );
      const x = inner.x + (inner.width - blockWidth) / 2;
      const y = inner.y + (inner.height - blockHeight) / 2;
      return [
        ...placeStack(left, { x, y, width: leftPx, height: blockHeight }, s, labelHeight, gap),
        ...placeStack(right, { x: x + leftPx + gap, y, width: rightPx, height: blockHeight }, s, labelHeight, gap),
      ];
    },
  };
}

/** All items in one row, each centred in the row, like a photographed flat lay. */
function rowCandidate(items: Sized[], inner: Box, gap: number, labelHeight: number, cap: number): Candidate {
  const totalWidth = sumCm(items, (s) => s.wCm);
  const tallest = maxCm(items, (s) => s.hCm);
  const scale = Math.min(
    (inner.width - gap * (items.length - 1)) / totalWidth,
    (inner.height - labelHeight) / tallest,
    cap,
  );

  return {
    scale,
    place: (s) => {
      const widths = items.map((it) => it.wCm * s);
      const blockWidth = widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
      const imageHeight = tallest * s;
      const blockHeight = imageHeight + labelHeight;
      let x = inner.x + (inner.width - blockWidth) / 2;
      const y0 = inner.y + (inner.height - blockHeight) / 2;

      return items.map((it, i) => {
        const width = widths[i];
        const height = it.hCm * s;
        const y = y0 + (imageHeight - height) / 2;
        const placement = {
          id: it.entry.id,
          x,
          y,
          width,
          height,
          labelX: x + width / 2,
          labelY: y + height + labelHeight / 2,
          labelWidth: width,
        } satisfies FlatLayPlacement;
        x += width + gap;
        return placement;
      });
    },
  };
}

/** One column of items, centred on the canvas. */
function singleColumnCandidate(items: Sized[], inner: Box, gap: number, labelHeight: number, cap: number): Candidate {
  const width = maxCm(items, (s) => s.wCm);
  const scale = Math.min(
    inner.width / width,
    (inner.height - labelHeight * items.length - gap * (items.length - 1)) / sumCm(items, (s) => s.hCm),
    cap,
  );

  return {
    scale,
    place: (s) => {
      const blockWidth = width * s;
      const blockHeight =
        sumCm(items, (it) => it.hCm) * s + labelHeight * items.length + gap * (items.length - 1);
      const x = inner.x + (inner.width - blockWidth) / 2;
      const y = inner.y + (inner.height - blockHeight) / 2;
      return placeStack(items, { x, y, width: blockWidth, height: blockHeight }, s, labelHeight, gap);
    },
  };
}

/** Splits one long group into two columns whose stacked heights are as even as possible. */
function splitBalanced(items: Sized[]): [Sized[], Sized[]] {
  const total = sumCm(items, (s) => s.hCm);
  let bestCut = Math.ceil(items.length / 2);
  let bestDiff = Number.POSITIVE_INFINITY;
  let acc = 0;
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].hCm;
    const diff = Math.abs(total - 2 * acc);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestCut = i + 1;
    }
  }
  return [items.slice(0, bestCut), items.slice(bestCut)];
}

/**
 * Lays an outfit out like a stylist's flat lay. Every item is drawn at its real-world size on
 * one shared scale (so a pair of trainers is about a third the length of the jeans), and the
 * arrangement is packed by measured size: the main garments in one column with the outerwear,
 * accessories and shoes around them, or all in a row, whichever fills the canvas more. The
 * whole block is centred on the canvas.
 */
export function layoutFlatLay(entries: FlatLayEntry[], format: FlatLayFormat): FlatLayPlacement[] {
  if (entries.length === 0) return [];

  const { width, height } = FLAT_LAY_SIZES[format];
  const margin = width * MARGIN;
  const gap = width * GAP;
  const labelHeight = width * LABEL_HEIGHT;
  const inner: Box = {
    x: margin,
    y: margin,
    width: width - margin * 2,
    height: height - margin * 2,
  };
  const cap = (UPGRADE_CAP * height) / CAP_REFERENCE_CM;

  const sized = entries.map(sizeInCm);
  const main = sized.filter((s) => MAIN_ROLES.includes(roleOf(s.entry.type))).sort(byRole(MAIN_ROLES));
  const side = sized.filter((s) => !MAIN_ROLES.includes(roleOf(s.entry.type))).sort(byRole(SIDE_ROLES));

  const candidates: Candidate[] = [];
  if (main.length > 0 && side.length > 0) {
    candidates.push(twoColumnCandidate(main, side, inner, gap, labelHeight, cap));
    candidates.push(rowCandidate([...main, ...side], inner, gap, labelHeight, cap));
  } else {
    const all = main.length > 0 ? main : side;
    if (all.length <= 3) {
      candidates.push(singleColumnCandidate(all, inner, gap, labelHeight, cap));
      candidates.push(rowCandidate(all, inner, gap, labelHeight, cap));
    } else {
      const [left, right] = splitBalanced(all);
      candidates.push(twoColumnCandidate(left, right, inner, gap, labelHeight, cap));
    }
  }

  // A candidate whose scale is not positive cannot fit the canvas at all (far more items than
  // it can hold); drop it rather than draw a broken picture.
  const valid = candidates.filter((c) => Number.isFinite(c.scale) && c.scale > 0);
  if (valid.length === 0) return [];
  // Candidates are listed in order of preference (columns before a single row). A row only wins
  // when it lets the garments be drawn clearly bigger: a row of three on a square canvas is a
  // thin band with empty space above and below, where columns fill the picture.
  const largest = Math.max(...valid.map((c) => c.scale));
  const chosen = valid.find((c) => c.scale >= largest * PREFERENCE_TOLERANCE) ?? valid[0];
  return chosen.place(chosen.scale);
}
