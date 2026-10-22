import { describe, expect, it } from 'vitest'
import {
  FLAT_LAY_SIZES,
  layoutFlatLay,
  type FlatLayEntry,
  type FlatLayFormat,
  type FlatLayPlacement,
} from '@/lib/flat-lay-layout'
import { longSideCm } from '@/lib/flat-lay-sizes'

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

  it('stacks tops over bottoms and orders the side pieces outerwear, accessories, footwear', () => {
    const placed = layoutFlatLay(FULL_OUTFIT, 'portrait')
    const at = (id: string) => placed.find((p) => p.id === id)!

    expect(at('top').y).toBeLessThan(at('bottom').y)
    expect(at('top').x + at('top').width).toBeLessThanOrEqual(at('shoes').x)
    expect(at('coat').y).toBeLessThan(at('belt').y)
    expect(at('belt').y).toBeLessThan(at('shoes').y)
  })

  it('lays shirt, jeans and trainers in columns on a square, not a thin row', () => {
    const outfit = [entry('shirt', 'shirt', 1), entry('jeans', 'jeans', 0.8), entry('shoes', 'sneakers', 1.5)]
    const placed = layoutFlatLay(outfit, 'square')
    const at = (id: string) => placed.find((p) => p.id === id)!

    // shirt above jeans, trainers beside them: the block is taller than it is wide
    expect(at('shirt').y).toBeLessThan(at('jeans').y)
    expect(at('shoes').x).toBeGreaterThan(at('jeans').x + at('jeans').width)
    const top = Math.min(...placed.map((p) => p.y))
    const bottom = Math.max(...placed.map((p) => p.labelY))
    const left = Math.min(...placed.map((p) => p.x))
    const right = Math.max(...placed.map((p) => p.x + p.width))
    expect(bottom - top).toBeGreaterThan(right - left)
  })

  it('still uses a row when it allows clearly bigger garments', () => {
    // a long dress with sandals: columns would force the dress much smaller than a row does
    const placed = layoutFlatLay([entry('dress', 'dress', 0.5), entry('sandals', 'sandals', 1.6)], 'square')
    const centre = (p: FlatLayPlacement) => p.y + p.height / 2

    expect(centre(placed[0])).toBeCloseTo(centre(placed[1]), 5)
    expect(placed.find((p) => p.id === 'dress')!.height).toBeGreaterThan(700)
  })

  it('draws the jeans 3.5x longer than the sneakers when both have the same aspect', () => {
    const placed = layoutFlatLay([entry('jeans', 'jeans', 1), entry('kicks', 'sneakers', 1)], 'square')
    const at = (id: string) => placed.find((p) => p.id === id)!
    const longSide = (p: FlatLayPlacement) => Math.max(p.width, p.height)

    expect(longSide(at('jeans')) / longSide(at('kicks'))).toBeCloseTo(105 / 30, 1)
  })

  it('draws the shirt shorter than the jeans whatever the cut-out aspects', () => {
    for (const shirtAspect of [0.5, 1, 2]) {
      for (const jeansAspect of [0.5, 1, 2]) {
        const placed = layoutFlatLay(
          [entry('s', 'shirt', shirtAspect), entry('j', 'jeans', jeansAspect)],
          'square',
        )
        const longSide = (id: string) => {
          const p = placed.find((x) => x.id === id)!
          return Math.max(p.width, p.height)
        }
        expect(longSide('s')).toBeLessThan(longSide('j'))
      }
    }
  })

  it('sizes an item by its type and aspect only, not by the picture pixels', () => {
    const placed = layoutFlatLay([entry('a', 'jeans', 0.55), entry('b', 'jeans', 0.55)], 'square')
    const [a, b] = placed

    expect(a.width).toBeCloseTo(b.width, 5)
    expect(a.height).toBeCloseTo(b.height, 5)
  })

  it('uses one shared scale for every item', () => {
    const placed = layoutFlatLay(FULL_OUTFIT, 'portrait')
    const ratios = placed.map((p) => {
      const entry = FULL_OUTFIT.find((e) => e.id === p.id)!
      return Math.max(p.width, p.height) / longSideCm(entry.type)
    })

    expect(Math.max(...ratios) / Math.min(...ratios)).toBeLessThanOrEqual(1.01)
  })

  it('does not blow up a lone small item past the upscale cap', () => {
    const [hat] = layoutFlatLay([entry('hat', 'hat', 1)], 'square')
    const capPx = ((0.85 * FLAT_LAY_SIZES.square.height) / 100) * longSideCm('hat')

    expect(Math.max(hat.width, hat.height)).toBeLessThanOrEqual(capPx + 1e-6)
  })

  it.each(FORMATS)(
    'lays out the screenshot outfit (shirt, jeans, sneakers) with the shoes smallest (%s)',
    (format) => {
      const outfit = [entry('shirt', 'shirt', 1), entry('jeans', 'jeans', 0.55), entry('sneakers', 'sneakers', 1.5)]
      const placed = layoutFlatLay(outfit, format)
      const at = (id: string) => placed.find((p) => p.id === id)!
      const longSide = (id: string) => Math.max(at(id).width, at(id).height)

      for (let i = 0; i < placed.length; i++) {
        for (let j = i + 1; j < placed.length; j++) {
          expect(overlaps(placed[i], placed[j])).toBe(false)
        }
      }
      expect(longSide('sneakers')).toBeLessThan(longSide('shirt'))
      expect(longSide('sneakers')).toBeLessThan(longSide('jeans'))
    },
  )

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
