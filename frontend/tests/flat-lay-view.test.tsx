import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FlatLayView } from '@/components/outfits/flat-lay-view'
import { api } from '@/lib/api'
import { useFlatLayItems } from '@/lib/hooks/use-flat-lay'
import * as renderLib from '@/lib/flat-lay-render'
import type { OutfitItem } from '@/lib/types'

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  setAccessToken: vi.fn(),
}))
vi.mock('@/lib/hooks/use-translated-constants', () => ({
  useTypeLabel: () => (type: string) => `type:${type}`,
}))
vi.mock('@/lib/flat-lay-render', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/flat-lay-render')>()),
  loadImage: vi.fn(async () => ({ width: 100, height: 100 }) as HTMLImageElement),
  drawFlatLay: vi.fn(),
  canvasToPng: vi.fn(async () => new Blob(['png'])),
}))

const item = (id: string, cutout: string | null = `/cut/${id}.png`): OutfitItem => ({
  id,
  type: 'shirt',
  subtype: null,
  name: `Item ${id}`,
  primary_color: null,
  colors: [],
  image_path: `${id}.jpg`,
  thumbnail_path: null,
  image_url: `/img/${id}.jpg`,
  thumbnail_url: null,
  cutout_url: cutout,
  layer_type: null,
  position: 0,
})

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
)

beforeEach(() => {
  vi.mocked(api.get).mockReset()
  vi.mocked(api.post).mockReset()
  vi.mocked(renderLib.drawFlatLay).mockClear()
  vi.mocked(renderLib.loadImage).mockClear()
})

describe('useFlatLayItems', () => {
  it('asks for the missing cut-outs once, after reading the outfit', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [item('a'), item('b', null)] })
    vi.mocked(api.post).mockResolvedValue({ ready: 1, queued: 1, item_ids: ['b'] })

    const { result } = renderHook(() => useFlatLayItems('o1', [], true, true), { wrapper })

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    expect(api.post).toHaveBeenCalledWith('/outfits/o1/flat-lay/cutouts')
    expect(result.current.preparing).toBe(true)
  })

  it('queues nothing when every item already has a cut-out', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [item('a'), item('b')] })

    const { result } = renderHook(() => useFlatLayItems('o1', [], true, true), { wrapper })

    await waitFor(() => expect(result.current.preparing).toBe(false))
    expect(api.post).not.toHaveBeenCalled()
    expect(result.current.failed).toBe(false)
  })

  it('never calls the server for an outfit that is not the viewer’s own', async () => {
    const { result } = renderHook(
      () => useFlatLayItems('o1', [item('a', null)], true, false),
      { wrapper },
    )

    expect(api.get).not.toHaveBeenCalled()
    expect(api.post).not.toHaveBeenCalled()
    expect(result.current.preparing).toBe(false)
    expect(result.current.failed).toBe(true)
  })

  it('stays idle until the flat lay is opened', () => {
    renderHook(() => useFlatLayItems('o1', [], false, true), { wrapper })

    expect(api.get).not.toHaveBeenCalled()
  })

  it('falls back to the photos when the outfit cannot be read', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('404'))

    const { result } = renderHook(
      () => useFlatLayItems('o1', [item('a', null)], true, true),
      { wrapper },
    )

    await waitFor(() => expect(result.current.preparing).toBe(false))
    expect(api.post).not.toHaveBeenCalled()
    expect(result.current.failed).toBe(true)
  })

  it('gives up with a failure when the queue request is refused', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [item('a', null)] })
    vi.mocked(api.post).mockRejectedValue(new Error('503'))

    const { result } = renderHook(() => useFlatLayItems('o1', [], true, true), { wrapper })

    await waitFor(() => expect(result.current.failed).toBe(true))
  })
})

describe('FlatLayView', () => {
  it('draws the picture from the cut-outs, with item names, in the chosen shape', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [item('a'), item('b')] })

    render(<FlatLayView outfitId="o1" items={[item('a'), item('b')]} isOwner />, { wrapper })

    await waitFor(() => expect(renderLib.drawFlatLay).toHaveBeenCalled())
    const [, pieces, format] = vi.mocked(renderLib.drawFlatLay).mock.calls.at(-1)!
    expect(format).toBe('square')
    expect(pieces.map((p) => p.label)).toEqual(['Item a', 'Item b'])
    expect(renderLib.loadImage).toHaveBeenCalledWith('/cut/a.png')

    fireEvent.click(screen.getByRole('button', { name: 'portrait' }))
    await waitFor(() => expect(vi.mocked(renderLib.drawFlatLay).mock.calls.at(-1)![2]).toBe('portrait'))
  })

  it('names an unnamed item by its type and uses its photo when it has no cut-out', async () => {
    const plain = { ...item('a', null), name: null }
    render(<FlatLayView outfitId="o1" items={[plain]} isOwner={false} />, { wrapper })

    await waitFor(() => expect(renderLib.drawFlatLay).toHaveBeenCalled())
    const pieces = vi.mocked(renderLib.drawFlatLay).mock.calls.at(-1)![1]
    expect(pieces[0].label).toBe('type:shirt')
    expect(renderLib.loadImage).toHaveBeenCalledWith('/img/a.jpg')
    expect(screen.getByText('someMissing')).toBeInTheDocument()
  })

  it('shows progress and holds back the download while cut-outs are made', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [item('a', null)] })
    vi.mocked(api.post).mockResolvedValue({ ready: 0, queued: 1, item_ids: ['a'] })

    render(<FlatLayView outfitId="o1" items={[item('a', null)]} isOwner />, { wrapper })

    expect(await screen.findByText('preparing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'download' })).toBeDisabled()
    expect(renderLib.drawFlatLay).not.toHaveBeenCalled()
  })

  it('downloads the picture as a PNG', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [item('a')] })
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<FlatLayView outfitId="o1" items={[item('a')]} isOwner />, { wrapper })
    const button = screen.getByRole('button', { name: 'download' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)

    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(create).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:x')
    click.mockRestore()
  })

  it('says so when the pictures cannot be loaded', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [item('a')] })
    vi.mocked(renderLib.loadImage).mockRejectedValueOnce(new Error('boom'))

    render(<FlatLayView outfitId="o1" items={[item('a')]} isOwner />, { wrapper })

    expect(await screen.findByText('loadFailed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'download' })).toBeDisabled()
  })

  it('leaves an item out of the picture when it is unticked, and never lets the last one go', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [item('a'), item('b')] })

    render(<FlatLayView outfitId="o1" items={[item('a'), item('b')]} isOwner />, { wrapper })
    await waitFor(() => expect(renderLib.drawFlatLay).toHaveBeenCalled())
    expect(vi.mocked(renderLib.drawFlatLay).mock.calls.at(-1)![1].map((p) => p.id)).toEqual(['a', 'b'])

    const boxes = screen.getAllByRole('checkbox')
    fireEvent.click(boxes[1])

    await waitFor(() =>
      expect(vi.mocked(renderLib.drawFlatLay).mock.calls.at(-1)![1].map((p) => p.id)).toEqual(['a']),
    )
    expect(boxes[0]).toBeDisabled()

    fireEvent.click(boxes[1])
    await waitFor(() =>
      expect(vi.mocked(renderLib.drawFlatLay).mock.calls.at(-1)![1].map((p) => p.id)).toEqual(['a', 'b']),
    )
  })

  it('shows no tick-boxes for a single item', async () => {
    vi.mocked(api.get).mockResolvedValue({ items: [item('a')] })

    render(<FlatLayView outfitId="o1" items={[item('a')]} isOwner />, { wrapper })
    await waitFor(() => expect(renderLib.drawFlatLay).toHaveBeenCalled())

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })
})
