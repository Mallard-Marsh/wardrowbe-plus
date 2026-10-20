import { describe, expect, it } from 'vitest'
import {
  FLAT_LAY_SIZES,
  layoutFlatLay,
  type FlatLayEntry,
  type FlatLayFormat,
  type FlatLayPlacement,
} from '@/lib/flat-lay-layout'

const entry = (id: string, type: string, aspect = 0.8): FlatLayEntry => ({ id, type, aspect })

const FULL_OUTFIT = [
  entry('top', 't-shirt', 1),
  entry('bottom', 'jeans', 0.55),
  entry('shoes', 'sneakers', 1.6),
  entry('coat', 'jacket', 0.9),
  entry('belt', 'belt', 3),
]

const overlaps = (a: FlatLayPlacement, b: FlatLayPlacement) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const FORMATS: FlatLayFormat[] = ['square', 'portrait']

describe('layoutFlatLay', () => {
  it('has the two Instagram shapes', () => {
    expect(FLAT_LAY_SIZES.square).toEqual({ width: 1080, height: 1080 })
    expect(FLAT_LAY_SIZES.portrait).toEqual({ width: 1080, height: 1350 })
  })

  it.each(FORMATS)('places every item inside the canvas (%s)', (format) => {
    const { width, height } = FLAT_LAY_SIZES[format]
    const placed = layoutFlatLay(FULL_OUTFIT, format)

    expect(placed.map((p) => p.id).sort()).toEqual(FULL_OUTFIT.map((e) => e.id).sort())
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x + p.width).toBeLessThanOrEqual(width)
      // the name printed under the garment stays on the canvas too
      expect(p.labelY).toBeLessThanOrEqual(height)
      expect(p.width).toBeGreaterThan(0)
      expect(p.height).toBeGreaterThan(0)
    }
  })

  it.each(FORMATS)('never lets pictures or labels overlap (%s)', (format) => {
    const placed = layoutFlatLay(FULL_OUTFIT, format)

    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i], placed[j])).toBe(false)
      }
    }
  })

  it('keeps each garment in proportion', () => {
    const placed = layoutFlatLay(FULL_OUTFIT, 'square')

    for (const e of FULL_OUTFIT) {
      const p = placed.find((x) => x.id === e.id)!
      expect(p.width / p.height).toBeCloseTo(e.aspect, 5)
    }
  })

  it('stacks the top above the bottom and puts outerwear, accessories and shoes beside them', () => {
    const placed = layoutFlatLay(FULL_OUTFIT, 'portrait')
    const at = (id: string) => placed.find((p) => p.id === id)!

    expect(at('top').y).toBeLessThan(at('bottom').y)
    expect(at('top').x + at('top').width).toBeLessThanOrEqual(at('shoes').x)
    expect(at('coat').y).toBeLessThan(at('belt').y)
    expect(at('belt').y).toBeLessThan(at('shoes').y)
  })

  it('gives shoes a smaller share than the trousers', () => {
    const placed = layoutFlatLay(FULL_OUTFIT, 'square')
    const at = (id: string) => placed.find((p) => p.id === id)!

    expect(at('shoes').height).toBeLessThan(at('bottom').height)
  })

  it('centres a single item', () => {
    const [only] = layoutFlatLay([entry('dress', 'dress', 0.6)], 'square')

    expect(only.x + only.width / 2).toBeCloseTo(FLAT_LAY_SIZES.square.width / 2, 5)
  })

  it('lays out an outfit made only of accessories in two columns', () => {
    const items = ['hat', 'scarf', 'belt', 'bag'].map((t) => entry(t, t, 1))
    const placed = layoutFlatLay(items, 'square')

    expect(placed).toHaveLength(4)
    expect(new Set(placed.map((p) => Math.round(p.x + p.width / 2))).size).toBe(2)
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) expect(overlaps(placed[i], placed[j])).toBe(false)
    }
  })

  it('treats a type it does not know as an accessory', () => {
    const placed = layoutFlatLay([entry('a', 't-shirt'), entry('b', 'mystery')], 'square')

    expect(placed).toHaveLength(2)
    expect(placed.find((p) => p.id === 'b')!.x).toBeGreaterThan(placed.find((p) => p.id === 'a')!.x)
  })

  it('returns nothing for an empty outfit', () => {
    expect(layoutFlatLay([], 'square')).toEqual([])
  })
})
