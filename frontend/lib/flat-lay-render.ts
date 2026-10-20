import {
  FLAT_LAY_SIZES,
  layoutFlatLay,
  type FlatLayFormat,
  type FlatLayPlacement,
} from '@/lib/flat-lay-layout';

export interface FlatLayPiece {
  id: string;
  type: string;
  label: string;
  image: CanvasImageSource & { width: number; height: number };
}

const BACKGROUND = '#ffffff';
const LABEL_COLOR = '#4b4b4b';
const LABEL_FONT_FAMILY = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let end = text.length;
  while (end > 1 && ctx.measureText(`${text.slice(0, end).trimEnd()}…`).width > maxWidth) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  piece: FlatLayPiece,
  place: FlatLayPlacement,
  canvasWidth: number,
) {
  // A soft shadow under the garment lifts it off the page like a photographed flat lay.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
  ctx.shadowBlur = canvasWidth * 0.018;
  ctx.shadowOffsetY = canvasWidth * 0.008;
  ctx.drawImage(piece.image, place.x, place.y, place.width, place.height);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = LABEL_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(canvasWidth * 0.028)}px ${LABEL_FONT_FAMILY}`;
  ctx.fillText(fitText(ctx, piece.label, place.labelWidth), place.labelX, place.labelY);
  ctx.restore();
}

/** Draws an outfit as a flat lay onto the canvas and sizes the canvas to the chosen format. */
export function drawFlatLay(
  canvas: HTMLCanvasElement,
  pieces: FlatLayPiece[],
  format: FlatLayFormat,
): void {
  const { width, height } = FLAT_LAY_SIZES[format];
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);

  const placements = layoutFlatLay(
    pieces.map((p) => ({
      id: p.id,
      type: p.type,
      aspect: p.image.width / Math.max(p.image.height, 1),
    })),
    format,
  );
  for (const place of placements) {
    const piece = pieces.find((p) => p.id === place.id);
    if (piece) drawPiece(ctx, piece, place, width);
  }
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))), 'image/png');
  });
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}
