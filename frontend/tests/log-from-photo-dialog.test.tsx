import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogFromPhotoDialog } from '@/components/outfits/log-from-photo-dialog'
import { ApiError } from '@/lib/api'
import type { PhotoGarment } from '@/lib/outfit-photo'

const mocks = vi.hoisted(() => ({
  match: vi.fn(),
  createItem: vi.fn(),
  createOutfit: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))
vi.mock('@/lib/hooks/use-outfit-photo', () => ({
  useMatchOutfitPhoto: () => ({ mutateAsync: mocks.match }),
}))
vi.mock('@/lib/hooks/use-items', () => ({
  useCreateItem: () => ({ mutateAsync: mocks.createItem }),
}))
vi.mock('@/lib/hooks/use-studio', () => ({
  useCreateStudioOutfit: () => ({ mutateAsync: mocks.createOutfit }),
}))
vi.mock('@/lib/hooks/use-user', () => ({ useUserToday: () => () => '2026-10-22' }))
vi.mock('@/lib/hooks/use-translated-constants', () => ({
  useTypeLabel: () => (type: string) => `type:${type}`,
  useOccasions: () => [
    { value: 'casual', label: 'Casual' },
    { value: 'office', label: 'Office' },
  ],
}))
vi.mock('@/lib/photo-crop', () => ({
  loadPhoto: vi.fn(async () => ({ image: { naturalWidth: 100, naturalHeight: 200 }, url: 'blob:photo' })),
  cropToJpeg: vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' })),
  cropToDataUrl: vi.fn(() => 'data:image/jpeg;base64,AAAA'),
}))

const garment = (
  type: string,
  match: PhotoGarment['match'],
  candidates: { id: string; name: string | null }[] = [],
): PhotoGarment => ({
  type,
  colors: [],
  box: { left: 0.1, top: 0.1, width: 0.4, height: 0.4 },
  match,
  candidates: candidates.map((c) => ({ item_id: c.id, name: c.name, type, thumbnail_url: `/t/${c.id}.jpg` })),
})

const SHIRT = garment('shirt', { item_id: 'shirt-1', confidence: 0.9 }, [
  { id: 'shirt-1', name: 'Blue shirt' },
  { id: 'shirt-2', name: 'White shirt' },
])
const JEANS = garment('jeans', { item_id: 'jeans-1', confidence: 0.3 }, [{ id: 'jeans-1', name: 'Jeans' }])
const COAT = garment('coat', null, [])

beforeEach(() => {
  Object.values(mocks).forEach((m) => 'mockReset' in m && m.mockReset())
  mocks.toast.success.mockReset()
  mocks.toast.error.mockReset()
  Element.prototype.setPointerCapture = vi.fn()
})

async function reachCrop() {
  const onClose = vi.fn()
  render(<LogFromPhotoDialog open onClose={onClose} />)
  const input = screen.getByLabelText('choosePhoto') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] } })
  await screen.findByTestId('crop-box')
  return { onClose }
}

async function reachReview(garments: PhotoGarment[]) {
  mocks.match.mockResolvedValueOnce({ garments })
  const view = await reachCrop()
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'continue' }))
  await screen.findByText('logButton')
  return view
}

describe('LogFromPhotoDialog', () => {
  it('says where the photo goes, and sends nothing until the crop is confirmed', async () => {
    await reachCrop()

    expect(screen.getByText('privacy')).toBeInTheDocument()
    expect(mocks.match).not.toHaveBeenCalled()
  })

  it('keeps Continue disabled until the person confirms their face is outside the box', async () => {
    await reachCrop()
    const next = screen.getByRole('button', { name: 'continue' })
    expect(next).toBeDisabled()

    fireEvent.click(screen.getByRole('checkbox'))

    expect(next).toBeEnabled()
    expect(mocks.match).not.toHaveBeenCalled()
  })

  it('sends only the cropped photo, then shows a row per garment with confident matches ticked', async () => {
    await reachReview([SHIRT, JEANS, COAT])

    expect(mocks.match).toHaveBeenCalledTimes(1)
    const sent = mocks.match.mock.calls[0][0] as Blob
    expect(sent).toBeInstanceOf(Blob)
    expect(screen.getAllByText(/garmentLabel/)).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Blue shirt' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'White shirt' })).toHaveAttribute('aria-pressed', 'false')
    // a doubtful match (0.3) is offered but not ticked
    expect(screen.getByRole('button', { name: 'Jeans' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('noCandidates')).toBeInTheDocument()
  })

  it('logs the chosen items as worn, with the occasion and date', async () => {
    mocks.createOutfit.mockResolvedValue({ id: 'o1' })
    const { onClose } = await reachReview([SHIRT, JEANS])

    fireEvent.click(screen.getByRole('button', { name: 'White shirt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jeans' }))
    fireEvent.change(screen.getByLabelText('occasion'), { target: { value: 'office' } })
    fireEvent.click(screen.getByRole('button', { name: /logButton/ }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mocks.createOutfit).toHaveBeenCalledWith({
      items: ['shirt-2', 'jeans-1'],
      occasion: 'office',
      scheduled_for: '2026-10-22',
      mark_worn: true,
    })
    expect(mocks.createItem).not.toHaveBeenCalled()
    expect(mocks.toast.success).toHaveBeenCalled()
  })

  it('adds a garment with no match as a new item before logging', async () => {
    mocks.createItem.mockResolvedValue({ id: 'new-1' })
    mocks.createOutfit.mockResolvedValue({ id: 'o1' })
    const { onClose } = await reachReview([SHIRT, COAT])

    fireEvent.click(screen.getAllByRole('button', { name: 'addAsNew' })[1])
    fireEvent.click(screen.getByRole('button', { name: /logButton/ }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const form = mocks.createItem.mock.calls[0][0] as FormData
    expect((form.get('image') as File).type).toBe('image/jpeg')
    expect(mocks.createOutfit.mock.calls[0][0].items).toEqual(['shirt-1', 'new-1'])
  })

  it('uses the existing item when the new item turns out to be a duplicate', async () => {
    mocks.createItem.mockRejectedValue(
      new ApiError('Duplicate image detected. This item already exists in your wardrobe (ID: 7d2c1f0e-1111-4222-8333-444455556666)', 409, {}),
    )
    mocks.createOutfit.mockResolvedValue({ id: 'o1' })
    const { onClose } = await reachReview([COAT])

    fireEvent.click(screen.getByRole('button', { name: 'addAsNew' }))
    fireEvent.click(screen.getByRole('button', { name: /logButton/ }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mocks.createOutfit.mock.calls[0][0].items).toEqual(['7d2c1f0e-1111-4222-8333-444455556666'])
  })

  it('cannot log when every garment is skipped', async () => {
    await reachReview([COAT])

    expect(screen.getByRole('button', { name: /logButton/ })).toBeDisabled()
    expect(screen.getByText('needOne')).toBeInTheDocument()
  })

  it('keeps the dialog open and says so when logging fails', async () => {
    mocks.createOutfit.mockRejectedValue(new Error('boom'))
    const { onClose } = await reachReview([SHIRT])

    fireEvent.click(screen.getByRole('button', { name: /logButton/ }))

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('says when no clothes were found, and goes back to the crop', async () => {
    mocks.match.mockResolvedValueOnce({ garments: [] })
    await reachCrop()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'continue' }))
    expect(await screen.findByText('noneFound')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'back' }))

    expect(await screen.findByTestId('crop-box')).toBeInTheDocument()
  })

  it('returns to the crop with an error when the photo cannot be read by the AI', async () => {
    mocks.match.mockRejectedValueOnce(new Error('502'))
    await reachCrop()
    fireEvent.click(screen.getByRole('checkbox'))

    fireEvent.click(screen.getByRole('button', { name: 'continue' }))

    expect(await screen.findByText('matchFailed')).toBeInTheDocument()
    expect(screen.getByTestId('crop-box')).toBeInTheDocument()
  })
})
