'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { canvasToPng, drawFlatLay, loadImage, type FlatLayPiece } from '@/lib/flat-lay-render';
import type { FlatLayFormat } from '@/lib/flat-lay-layout';
import { hasCutout, useFlatLayItems } from '@/lib/hooks/use-flat-lay';
import { useTypeLabel } from '@/lib/hooks/use-translated-constants';
import type { OutfitItem } from '@/lib/types';

interface FlatLayViewProps {
  outfitId: string;
  items: OutfitItem[];
  isOwner: boolean;
}

const FORMATS: FlatLayFormat[] = ['square', 'portrait'];

export function FlatLayView({ outfitId, items, isOwner }: FlatLayViewProps) {
  const t = useTranslations('suggest.outfitPreview.flatLay');
  const typeLabel = useTypeLabel();
  const [format, setFormat] = useState<FlatLayFormat>('square');
  const [drawn, setDrawn] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // Items left out of the picture; only this screen remembers it, nothing is saved.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { items: resolved, preparing, failed } = useFlatLayItems(outfitId, items, true, isOwner);

  // The signed URLs change on every fetch, so the picture is redrawn only when an item or its
  // cut-out changes, not whenever the data is read again.
  const signature = resolved
    .map((i) => `${i.id}:${hasCutout(i) ? 'c' : 'p'}:${hidden.has(i.id) ? 'h' : 's'}`)
    .join('|');
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  const typeLabelRef = useRef(typeLabel);
  typeLabelRef.current = typeLabel;
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  useEffect(() => {
    if (preparing) return;
    let cancelled = false;
    const source = resolvedRef.current.filter(
      (i) => (i.cutout_url || i.image_url) && !hiddenRef.current.has(i.id),
    );

    Promise.all(
      source.map(async (item) => ({
        id: item.id,
        type: item.type,
        label: item.name || typeLabelRef.current(item.type),
        image: await loadImage((item.cutout_url ?? item.image_url) as string),
      })),
    )
      .then((pieces: FlatLayPiece[]) => {
        if (cancelled || !canvasRef.current) return;
        drawFlatLay(canvasRef.current, pieces, format);
        setLoadFailed(false);
        setDrawn(true);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [preparing, signature, format]);

  const aspectClass = useMemo(() => (format === 'square' ? 'aspect-square' : 'aspect-[4/5]'), [format]);

  const handleDownload = async () => {
    if (!canvasRef.current) return;
    try {
      const blob = await canvasToPng(canvasRef.current);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `flat-lay-${format}.png`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('downloadFailed'));
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1" role="group" aria-label={t('shape')}>
          {FORMATS.map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant={format === f ? 'secondary' : 'ghost'}
              className="h-7 text-xs"
              aria-pressed={format === f}
              onClick={() => setFormat(f)}
            >
              {t(f)}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1.5"
          disabled={!drawn || preparing || loadFailed}
          onClick={handleDownload}
        >
          <Download className="h-3 w-3" />
          {t('download')}
        </Button>
      </div>

      <div className={`relative w-full max-w-md mx-auto rounded-md border bg-white ${aspectClass}`}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t('alt')}
          className={`absolute inset-0 h-full w-full rounded-md ${preparing ? 'invisible' : ''}`}
        />
        {preparing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('preparing')}
          </div>
        )}
      </div>

      {resolved.length > 1 && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-muted-foreground">{t('includeItems')}</legend>
          {resolved.map((item) => {
            const shown = !hidden.has(item.id);
            const onlyOneLeft = shown && resolved.length - hidden.size === 1;
            const label = item.name || typeLabel(item.type);
            return (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={shown}
                  disabled={onlyOneLeft}
                  onCheckedChange={(checked) =>
                    setHidden((current) => {
                      const next = new Set(current);
                      if (checked === true) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                />
                <span className="truncate">{label}</span>
              </label>
            );
          })}
        </fieldset>
      )}

      {loadFailed && <p className="text-xs text-destructive">{t('loadFailed')}</p>}
      {failed && !loadFailed && <p className="text-xs text-muted-foreground">{t('someMissing')}</p>}
    </div>
  );
}
