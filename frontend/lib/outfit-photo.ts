import type { Box } from '@/lib/split-boxes';

export interface PhotoCandidate {
  item_id: string;
  name: string | null;
  type: string;
  thumbnail_url: string | null;
}

export interface PhotoGarment {
  type: string;
  colors: string[];
  box: Box;
  match: { item_id: string; confidence: number } | null;
  candidates: PhotoCandidate[];
}

/** What the person decided for one garment in the photo. */
export type Choice = { kind: 'item'; itemId: string } | { kind: 'new' } | { kind: 'skip' };

/** A match the AI is less sure of than this is offered, never pre-ticked. */
export const MIN_PRESELECT_CONFIDENCE = 0.5;

/** Where the crop box starts: most of the photo, below the top where a face usually is. */
export const INITIAL_CROP: Box = { left: 0.05, top: 0.22, width: 0.9, height: 0.76 };

/** Longest side of the cropped photo sent to the AI, and of a garment photo saved as an item. */
export const PHOTO_UPLOAD_PX = 1600;
export const NEW_ITEM_PX = 1200;

export function initialChoice(garment: PhotoGarment): Choice {
  const { match } = garment;
  if (match && match.confidence >= MIN_PRESELECT_CONFIDENCE) {
    return { kind: 'item', itemId: match.item_id };
  }
  return { kind: 'skip' };
}

export function sameChoice(a: Choice, b: Choice): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'item' && b.kind === 'item' ? a.itemId === b.itemId : true;
}

/** The wardrobe items an outfit would be logged with, each once, in the order of the garments. */
export function chosenItemIds(choices: readonly Choice[]): string[] {
  const ids = choices.flatMap((c) => (c.kind === 'item' ? [c.itemId] : []));
  return Array.from(new Set(ids));
}

export function newItemCount(choices: readonly Choice[]): number {
  return choices.filter((c) => c.kind === 'new').length;
}

/** The outfit can be logged once at least one garment goes into it, as a match or a new item. */
export function canLogOutfit(choices: readonly Choice[]): boolean {
  return choices.some((c) => c.kind === 'item' || c.kind === 'new');
}
