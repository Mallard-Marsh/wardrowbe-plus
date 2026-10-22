import type { Box } from '@/lib/split-boxes';

export interface LoadedPhoto {
  image: HTMLImageElement;
  url: string;
}

/** Loads a file or blob for drawing; the caller revokes `url` when finished. */
export function loadPhoto(blob: Blob): Promise<LoadedPhoto> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read the photo'));
    };
    image.src = url;
  });
}

function drawBox(image: HTMLImageElement, box: Box, maxPx: number): HTMLCanvasElement {
  const sx = box.left * image.naturalWidth;
  const sy = box.top * image.naturalHeight;
  const sw = Math.max(box.width * image.naturalWidth, 1);
  const sh = Math.max(box.height * image.naturalHeight, 1);
  const scale = Math.min(1, maxPx / Math.max(sw, sh));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(Math.round(sw * scale), 1);
  canvas.height = Math.max(Math.round(sh * scale), 1);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Cuts a box out of the photo as a JPEG, shrunk so its longer side is at most maxPx. The
 *  photo is re-encoded from pixels, so nothing outside the box (and no EXIF) is carried along. */
export function cropToJpeg(image: HTMLImageElement, box: Box, maxPx: number): Promise<Blob> {
  const canvas = drawBox(image, box, maxPx);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))),
      'image/jpeg',
      0.9,
    );
  });
}

/** A small data URL of a box, for showing which garment a row is about. */
export function cropToDataUrl(image: HTMLImageElement, box: Box, maxPx = 160): string {
  return drawBox(image, box, maxPx).toDataURL('image/jpeg', 0.8);
}
