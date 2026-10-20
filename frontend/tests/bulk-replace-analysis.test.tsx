import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BulkActionToolbar, type BulkSelection } from '@/components/bulk-action-toolbar'
import { BulkReplaceAnalysisButton } from '@/components/bulk-replace-analysis-button'
import { api } from '@/lib/api'
import { useBulkReanalyzeItems } from '@/lib/hooks/use-items'

vi.unmock('next-intl')
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { post: vi.fn(), get: vi.fn().mockResolvedValue([]) },
  getAccessToken: vi.fn(() => null),
}))

function catalog(locale: string, namespace: string) {
  return JSON.parse(readFileSync(resolve(__dirname, '..', 'messages', locale, `${namespace}.json`), 'utf8'))
}
const wardrobe = catalog('en', 'wardrobe').bulkActions
const common = catalog('en', 'common')

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const messages = Object.fromEntries(['wardrobe', 'common', 'outfits'].map((ns) => [ns, catalog('en', ns)]))
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages} onError={() => {}}>
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  )
}

const replaceButton = () => screen.getByRole('button', { name: common.bulkActions.reanalyzeAndReplace })

describe('BulkReplaceAnalysisButton', () => {
  it('asks first, naming how many items are affected', () => {
    render(<BulkReplaceAnalysisButton count={3} onConfirm={vi.fn()} />, { wrapper: Providers })
    fireEvent.click(replaceButton())

    expect(screen.getByText('Re-analyze and replace AI tags for 3 items?')).toBeInTheDocument()
    expect(screen.getByText(wardrobe.reanalyzeAndReplaceConfirmDescription)).toBeInTheDocument()
  })

  it('uses the singular for one item', () => {
    render(<BulkReplaceAnalysisButton count={1} onConfirm={vi.fn()} />, { wrapper: Providers })
    fireEvent.click(replaceButton())
    expect(screen.getByText('Re-analyze and replace AI tags for 1 item?')).toBeInTheDocument()
  })

  it('does nothing when cancelled', async () => {
    const onConfirm = vi.fn()
    render(<BulkReplaceAnalysisButton count={3} onConfirm={onConfirm} />, { wrapper: Providers })
    fireEvent.click(replaceButton())
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByText(/for 3 items\?/)).not.toBeInTheDocument())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('goes ahead when confirmed', () => {
    const onConfirm = vi.fn()
    render(<BulkReplaceAnalysisButton count={3} onConfirm={onConfirm} />, { wrapper: Providers })
    fireEvent.click(replaceButton())
    fireEvent.click(screen.getByRole('button', { name: wardrobe.reanalyzeAndReplaceConfirmAction }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('is disabled while an analysis is being queued', () => {
    render(<BulkReplaceAnalysisButton count={3} pending onConfirm={vi.fn()} />, { wrapper: Providers })
    expect(replaceButton()).toBeDisabled()
  })
})

describe('BulkActionToolbar with the replace action', () => {
  const selection: BulkSelection = { mode: 'some', selectedIds: new Set(['a', 'b']), excludedIds: new Set() }

  function renderToolbar(extra: Record<string, unknown> = {}) {
    render(
      <BulkActionToolbar
        selection={selection}
        totalItems={10}
        pageItems={10}
        onSelectAll={vi.fn()}
        onSelectAllMatching={vi.fn()}
        onClear={vi.fn()}
        onDelete={vi.fn()}
        onReanalyze={vi.fn()}
        {...extra}
      />,
      { wrapper: Providers },
    )
  }

  it('shows the replace button only when the page offers it', () => {
    renderToolbar()
    expect(screen.queryByRole('button', { name: common.bulkActions.reanalyzeAndReplace })).not.toBeInTheDocument()
  })

  it('counts the selected items in the confirm question', () => {
    renderToolbar({ onReanalyzeReplace: vi.fn() })
    fireEvent.click(replaceButton())
    expect(screen.getByText('Re-analyze and replace AI tags for 2 items?')).toBeInTheDocument()
  })

  it('keeps the ordinary re-analyse button working on its own', () => {
    const onReanalyze = vi.fn()
    const onReanalyzeReplace = vi.fn()
    renderToolbar({ onReanalyze, onReanalyzeReplace })
    fireEvent.click(screen.getByRole('button', { name: common.bulkActions.reanalyze }))

    expect(onReanalyze).toHaveBeenCalledTimes(1)
    expect(onReanalyzeReplace).not.toHaveBeenCalled()
  })

  it('disables both re-analyse buttons while one is running', () => {
    renderToolbar({ onReanalyzeReplace: vi.fn(), isReanalyzing: true })
    expect(replaceButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: common.bulkActions.reanalyze })).toBeDisabled()
  })
})

describe('useBulkReanalyzeItems', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset()
    vi.mocked(api.post).mockResolvedValue({ queued: 2, failed: 0, skipped: 0, cooldown: 0, has_more: false })
  })

  async function run(params: Parameters<ReturnType<typeof useBulkReanalyzeItems>['mutateAsync']>[0]) {
    const { result } = renderHook(() => useBulkReanalyzeItems(), { wrapper: Providers })
    await act(async () => {
      await result.current.mutateAsync(params)
    })
  }

  it('sends replace with an explicit list of items', async () => {
    await run({ item_ids: ['a', 'b'], replace: true })

    expect(api.post).toHaveBeenCalledWith('/items/bulk/analyze', {
      item_ids: ['a', 'b'],
      replace: true,
    })
  })

  it('sends replace with select all, covering the whole wardrobe', async () => {
    await run({ select_all: true, excluded_ids: ['x'], filters: { is_archived: false }, replace: true })

    expect(api.post).toHaveBeenCalledWith('/items/bulk/analyze', {
      select_all: true,
      excluded_ids: ['x'],
      filters: { is_archived: false },
      replace: true,
    })
  })

  it('sends nothing extra for an ordinary re-analysis', async () => {
    await run({ item_ids: ['a'] })

    const body = vi.mocked(api.post).mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('replace')
  })
})
