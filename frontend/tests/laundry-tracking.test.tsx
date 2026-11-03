import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ItemDetailDialog } from '@/components/item-detail-dialog'
import { ItemPicker } from '@/components/shared/item-picker'
import { api } from '@/lib/api'
import type { Item } from '@/lib/types'

vi.unmock('next-intl')
vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  setAccessToken: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

function catalog(namespace: string) {
  return JSON.parse(readFileSync(resolve(__dirname, '..', 'messages', 'en', `${namespace}.json`), 'utf8'))
}
const actions = catalog('wardrobe').itemDetail.actions

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const all = Object.fromEntries(
    ['wardrobe', 'constants', 'common', 'outfits'].map((ns) => [ns, catalog(ns)])
  )
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={all} onError={() => {}}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

const item = {
  id: 'i1',
  type: 'shirt',
  status: 'ready',
  tags: { colors: ['navy'], style: [], season: [] },
  images: [],
  image_url: 'https://example.test/i1.jpg?x=1',
  thumbnail_url: 'https://example.test/i1-thumb.jpg',
  wear_count: 2,
  wears_since_wash: 3,
  effective_wash_interval: 3,
  needs_wash: true,
} as unknown as Item

// Answers every GET, with the stored preference for wear and wash tracking.
function preferencesSay(trackLaundry: boolean | undefined) {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/users/me/preferences') {
      return trackLaundry === undefined ? {} : { track_laundry: trackLaundry }
    }
    if (url === '/items') return { items: [], total: 0, page: 1, page_size: 24, has_more: false }
    // Wear stats and wash history: nothing to show.
    return null
  })
}

function renderDialog() {
  render(<ItemDetailDialog item={item} open onOpenChange={() => {}} />, { wrapper: Wrapper })
}

describe('wear and wash tracking', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset()
  })

  it('shows Log wear and Mark washed while tracking is on', async () => {
    preferencesSay(true)
    renderDialog()

    expect(await screen.findByText(actions.logWear)).toBeInTheDocument()
    expect(screen.getByText(actions.markWashed)).toBeInTheDocument()
  })

  it('treats a missing setting as on', async () => {
    preferencesSay(undefined)
    renderDialog()

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/users/me/preferences'))
    expect(screen.getByText(actions.logWear)).toBeInTheDocument()
  })

  it('hides Log wear, Mark washed and the wash status once tracking is off', async () => {
    preferencesSay(false)
    renderDialog()

    await waitFor(() => expect(screen.queryByText(actions.logWear)).not.toBeInTheDocument())
    expect(screen.queryByText(actions.markWashed)).not.toBeInTheDocument()
    // Wears from outfits are still counted and shown.
    expect(screen.getByText(/Worn 2 times/)).toBeInTheDocument()
  })

  it('the item picker leaves out clothes that need a wash only while tracking is on', async () => {
    preferencesSay(false)
    render(<ItemPicker selectedIds={new Set()} onToggle={() => {}} />, { wrapper: Wrapper })

    await waitFor(() => {
      const lists = vi.mocked(api.get).mock.calls.filter(([url]) => url === '/items')
      const last = lists.at(-1)?.[1] as { params: Record<string, string> } | undefined
      expect(last?.params).toBeDefined()
      expect(last?.params.needs_wash).toBeUndefined()
    })
  })
})
