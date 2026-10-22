import { describe, expect, it } from 'vitest'
import {
  INITIAL_CROP,
  MIN_PRESELECT_CONFIDENCE,
  canLogOutfit,
  chosenItemIds,
  initialChoice,
  newItemCount,
  sameChoice,
  type Choice,
  type PhotoGarment,
} from '@/lib/outfit-photo'

const garment = (match: PhotoGarment['match']): PhotoGarment => ({
  type: 'shirt',
  colors: ['blue'],
  box: { left: 0, top: 0, width: 0.5, height: 0.5 },
  match,
  candidates: [],
})

describe('initialChoice', () => {
  it('ticks a confident match', () => {
    expect(initialChoice(garment({ item_id: 'a', confidence: 0.9 }))).toEqual({ kind: 'item', itemId: 'a' })
    expect(initialChoice(garment({ item_id: 'a', confidence: MIN_PRESELECT_CONFIDENCE }))).toEqual({
      kind: 'item',
      itemId: 'a',
    })
  })

  it('leaves a doubtful or missing match skipped, for the person to choose', () => {
    expect(initialChoice(garment({ item_id: 'a', confidence: 0.3 }))).toEqual({ kind: 'skip' })
    expect(initialChoice(garment(null))).toEqual({ kind: 'skip' })
  })
})

describe('choices', () => {
  const item = (id: string): Choice => ({ kind: 'item', itemId: id })

  it('lists each chosen wardrobe item once, in order', () => {
    expect(chosenItemIds([item('a'), { kind: 'skip' }, item('b'), item('a'), { kind: 'new' }])).toEqual(['a', 'b'])
  })

  it('counts the garments to add as new items', () => {
    expect(newItemCount([{ kind: 'new' }, item('a'), { kind: 'new' }, { kind: 'skip' }])).toBe(2)
  })

  it('can log once any garment is a match or a new item, but not when everything is skipped', () => {
    expect(canLogOutfit([{ kind: 'skip' }, { kind: 'skip' }])).toBe(false)
    expect(canLogOutfit([])).toBe(false)
    expect(canLogOutfit([{ kind: 'skip' }, item('a')])).toBe(true)
    expect(canLogOutfit([{ kind: 'new' }])).toBe(true)
  })

  it('compares choices by kind and item', () => {
    expect(sameChoice(item('a'), item('a'))).toBe(true)
    expect(sameChoice(item('a'), item('b'))).toBe(false)
    expect(sameChoice({ kind: 'new' }, { kind: 'new' })).toBe(true)
    expect(sameChoice({ kind: 'new' }, { kind: 'skip' })).toBe(false)
  })
})

describe('INITIAL_CROP', () => {
  it('starts below the top of the photo and inside it', () => {
    expect(INITIAL_CROP.top).toBeGreaterThan(0.15)
    expect(INITIAL_CROP.left + INITIAL_CROP.width).toBeLessThanOrEqual(1)
    expect(INITIAL_CROP.top + INITIAL_CROP.height).toBeLessThanOrEqual(1)
  })
})
