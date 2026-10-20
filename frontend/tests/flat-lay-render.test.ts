import { describe, expect, it, vi } from 'vitest'
import { canvasToPng, drawFlatLay, type FlatLayPiece } from '@/lib/flat-lay-render'
import { FLAT_LAY_SIZES } from '@/lib/flat-lay-layout'

function fakeCanvas(measure: (text: string) => number = (t) => t.length * 20) {
  const ctx = {
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetY: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: measure(text) })),
    save: vi.fn(),
    restore: vi.fn(),
  }
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement
  return { canvas, ctx }
}

const piece = (id: string, type: string, label: string): FlatLayPiece => ({
  id,
  type,
  label,
  image: { width: 400, height: 500 } as FlatLayPiece['image'],
})

describe('drawFlatLay', () => {
  it('sizes the canvas to the chosen shape and paints it white first', () => {
    const { canvas, ctx } = fakeCanvas()

    drawFlatLay(canvas, [piece('a', 'shirt', 'Shirt')], 'portrait')

    expect(canvas.width).toBe(FLAT_LAY_SIZES.portrait.width)
    expect(canvas.height).toBe(FLAT_LAY_SIZES.portrait.height)
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1080, 1350)
    expect(ctx.fillRect.mock.invocationCallOrder[0]).toBeLessThan(ctx.drawImage.mock.invocationCallOrder[0])
  })

  it('draws every garment with a shadow and prints its name beneath it', () => {
    const { canvas, ctx } = fakeCanvas()

    drawFlatLay(canvas, [piece('a', 'shirt', 'Blue shirt'), piece('b', 'jeans', 'Jeans')], 'square')

    expect(ctx.drawImage).toHaveBeenCalledTimes(2)
    expect(ctx.fillText.mock.calls.map((c) => c[0])).toEqual(['Blue shirt', 'Jeans'])
    // the shadow is switched off again so the label text is not shadowed
    expect(ctx.save).toHaveBeenCalledTimes(ctx.restore.mock.calls.length)
  })

  it('shortens a name that does not fit under its garment', () => {
    const { canvas, ctx } = fakeCanvas()
    const long = 'A very long garment name that cannot possibly fit on one line'

    drawFlatLay(canvas, [piece('a', 'shirt', long)], 'square')

    const printed = ctx.fillText.mock.calls[0][0] as string
    expect(printed.endsWith('…')).toBe(true)
    expect(printed.length).toBeLessThan(long.length)
  })

  it('does nothing when there is no 2d context', () => {
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement

    expect(() => drawFlatLay(canvas, [piece('a', 'shirt', 'Shirt')], 'square')).not.toThrow()
  })
})

describe('canvasToPng', () => {
  it('resolves with the blob', async () => {
    const blob = new Blob(['x'])
    const canvas = { toBlob: (cb: (b: Blob | null) => void) => cb(blob) } as unknown as HTMLCanvasElement

    await expect(canvasToPng(canvas)).resolves.toBe(blob)
  })

  it('rejects when the canvas cannot be encoded', async () => {
    const canvas = { toBlob: (cb: (b: Blob | null) => void) => cb(null) } as unknown as HTMLCanvasElement

    await expect(canvasToPng(canvas)).rejects.toThrow()
  })
})
