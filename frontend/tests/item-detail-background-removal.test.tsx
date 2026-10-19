import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ItemDetailDialog } from '@/components/item-detail-dialog'
import type { Item } from '@/lib/types'
import { api } from '@/lib/api'
import { toast } from 'sonner'

vi.unmock('next-intl')
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  setAccessToken: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

function messages(namespace: string) {
  return JSON.parse(readFileSync(resolve(__dirname, '..', 'messages', 'en', `${namespace}.json`), 'utf8'))
}

const wardrobe = messages('wardrobe')

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const all = Object.fromEntries(['wardrobe', 'constants', 'common'].map((ns) => [ns, messages(ns)]))
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={all} onError={() => {}}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    type: 'shirt',
    status: 'ready',
    tags: {},
    images: [],
    image_url: 'https://example.test/i1.jpg?x=1',
    thumbnail_url: 'https://example.test/i1-thumb.jpg',
    original_image_path: null,
    wear_count: 0,
    wears_since_wash: 0,
    effective_wash_interval: 3,
    ...overrides,
  } as unknown as Item
}

function renderDialog(item: Item) {
  const view = render(<ItemDetailDialog item={item} open onOpenChange={() => {}} />, { wrapper: Wrapper })
  const rerender = (next: Item) =>
    view.rerender(<ItemDetailDialog item={next} open onOpenChange={() => {}} />)
  return { ...view, rerender }
}

describe('background removal runs on the image worker', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.info).mockClear()
    vi.mocked(api.post).mockReset()
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === '/health/features' ? { background_removal: true, max_upload_size_mb: 10 } : [],
    )
  })

  it('says the removal was queued, not that it is done', async () => {
    vi.mocked(api.post).mockResolvedValue(makeItem({ status: 'processing' }))
    renderDialog(makeItem())

    fireEvent.click(await screen.findByTitle(wardrobe.itemDetail.titles.removeBackground))

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(wardrobe.itemDetail.actions.backgroundRemovalStarted),
    )
    expect(api.post).toHaveBeenCalledWith('/items/i1/remove-background', { bg_color: '#FFFFFF' })
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('announces completion when the backup path appears on the item being shown', () => {
    const view = renderDialog(makeItem({ status: 'processing' }))
    expect(toast.success).not.toHaveBeenCalled()

    view.rerender(makeItem({ status: 'ready', original_image_path: 'u/i1_orig.jpg' }))

    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith(wardrobe.itemDetail.actions.backgroundRemoved)
  })

  it('stays quiet when the dialog opens on an item that already has a backup', () => {
    renderDialog(makeItem({ original_image_path: 'u/i1_orig.jpg' }))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('stays quiet when switching to another item that has a backup', () => {
    const view = renderDialog(makeItem())
    view.rerender(makeItem({ id: 'i2', original_image_path: 'u/i2_orig.jpg' }))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('stays quiet when the original is restored', () => {
    const view = renderDialog(makeItem({ original_image_path: 'u/i1_orig.jpg' }))
    view.rerender(makeItem({ original_image_path: null }))
    expect(toast.success).not.toHaveBeenCalled()
  })
})
