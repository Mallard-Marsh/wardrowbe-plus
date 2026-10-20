import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { BulkActionToolbar, type BulkSelection } from '@/components/bulk-action-toolbar'

vi.unmock('next-intl')

function catalog(namespace: string) {
  return JSON.parse(readFileSync(resolve(__dirname, '..', 'messages', 'en', `${namespace}.json`), 'utf8'))
}
const common = catalog('common')

function Providers({ children }: { children: ReactNode }) {
  const messages = Object.fromEntries(['wardrobe', 'common', 'outfits'].map((ns) => [ns, catalog(ns)]))
  return (
    <NextIntlClientProvider locale="en" messages={messages} onError={() => {}}>
      {children}
    </NextIntlClientProvider>
  )
}

const selection: BulkSelection = { mode: 'some', selectedIds: new Set(['a', 'b']), excludedIds: new Set() }

function renderToolbar() {
  render(
    <BulkActionToolbar
      selection={selection}
      totalItems={200}
      pageItems={20}
      onSelectAll={vi.fn()}
      onSelectAllMatching={vi.fn()}
      onClear={vi.fn()}
      onDelete={vi.fn()}
      onReanalyze={vi.fn()}
      onReanalyzeReplace={vi.fn()}
      onRotate={vi.fn()}
      onRemoveBackground={vi.fn()}
      pagination={{ page: 2, pageSize: 20, onPageChange: vi.fn() }}
    />,
    { wrapper: Providers },
  )
}

describe('bulk toolbar hover labels', () => {
  it('gives every icon button a hover title that matches its accessible name', () => {
    renderToolbar()
    const labelled = screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-label'))

    // clear, re-analyse, replace, rotate x2, remove background, delete, and four page buttons
    expect(labelled.length).toBeGreaterThanOrEqual(11)
    for (const button of labelled) {
      expect(button.getAttribute('title'), button.getAttribute('aria-label') ?? '').toBe(
        button.getAttribute('aria-label'),
      )
    }
  })

  it.each([
    ['replace', common.bulkActions.reanalyzeAndReplace],
    ['re-analyse', common.bulkActions.reanalyze],
    ['remove background', common.bulkActions.removeBackground],
    ['rotate left', common.bulkActions.rotateCcw],
    ['rotate right', common.bulkActions.rotateCw],
    ['clear selection', common.bulkActions.clearSelection],
  ])('shows "%s" on hover', (_, label) => {
    renderToolbar()
    expect(screen.getByTitle(label)).toBeInTheDocument()
  })
})
