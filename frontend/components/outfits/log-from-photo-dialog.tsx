'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BoxFrame } from '@/components/box-frame';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, getErrorMessage } from '@/lib/api';
import { ACCEPTED_IMAGE_INPUT } from '@/lib/image-types';
import { useCreateItem } from '@/lib/hooks/use-items';
import { useMatchOutfitPhoto } from '@/lib/hooks/use-outfit-photo';
import { useCreateStudioOutfit } from '@/lib/hooks/use-studio';
import { useOccasions, useTypeLabel } from '@/lib/hooks/use-translated-constants';
import { useUserToday } from '@/lib/hooks/use-user';
import {
  INITIAL_CROP,
  NEW_ITEM_PX,
  PHOTO_UPLOAD_PX,
  canLogOutfit,
  chosenItemIds,
  initialChoice,
  newItemCount,
  sameChoice,
  type Choice,
  type PhotoGarment,
} from '@/lib/outfit-photo';
import { cropToDataUrl, cropToJpeg, loadPhoto, type LoadedPhoto } from '@/lib/photo-crop';
import type { Box } from '@/lib/split-boxes';

interface LogFromPhotoDialogProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'pick' | 'crop' | 'matching' | 'review';

// A duplicate upload answers 409 with the id of the item it matches; that item is the one to log.
const DUPLICATE_ID = /ID: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

export function LogFromPhotoDialog({ open, onClose }: LogFromPhotoDialogProps) {
  const t = useTranslations('outfits.logFromPhoto');
  const tc = useTranslations('common');
  const typeLabel = useTypeLabel();
  const occasions = useOccasions();
  const today = useUserToday();
  const matchPhoto = useMatchOutfitPhoto();
  const createItem = useCreateItem();
  const createOutfit = useCreateStudioOutfit();

  const [step, setStep] = useState<Step>('pick');
  const [photo, setPhoto] = useState<LoadedPhoto | null>(null);
  const [crop, setCrop] = useState<Box>(INITIAL_CROP);
  const [faceConfirmed, setFaceConfirmed] = useState(false);
  const [garments, setGarments] = useState<PhotoGarment[]>([]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [occasion, setOccasion] = useState('casual');
  const [date, setDate] = useState(() => today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The cropped photo, kept only while the review screen needs it to cut out new items.
  const cropped = useRef<LoadedPhoto | null>(null);
  const original = useRef<LoadedPhoto | null>(null);

  useEffect(() => {
    return () => {
      for (const loaded of [original.current, cropped.current]) {
        if (loaded) URL.revokeObjectURL(loaded.url);
      }
    };
  }, []);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const loaded = await loadPhoto(file);
      if (original.current) URL.revokeObjectURL(original.current.url);
      original.current = loaded;
      setPhoto(loaded);
      setCrop(INITIAL_CROP);
      setFaceConfirmed(false);
      setStep('crop');
    } catch {
      setError(t('readFailed'));
    }
  };

  const handleContinue = async () => {
    if (!photo) return;
    setError(null);
    setStep('matching');
    try {
      const blob = await cropToJpeg(photo.image, crop, PHOTO_UPLOAD_PX);
      const [result, loaded] = await Promise.all([matchPhoto.mutateAsync(blob), loadPhoto(blob)]);
      if (cropped.current) URL.revokeObjectURL(cropped.current.url);
      cropped.current = loaded;
      setGarments(result.garments);
      setThumbs(result.garments.map((g) => cropToDataUrl(loaded.image, g.box)));
      setChoices(result.garments.map(initialChoice));
      setStep('review');
    } catch (e) {
      setError(getErrorMessage(e, t('matchFailed')));
      setStep('crop');
    }
  };

  const idForNewGarment = async (garment: PhotoGarment): Promise<string> => {
    const blob = await cropToJpeg(cropped.current!.image, garment.box, NEW_ITEM_PX);
    const formData = new FormData();
    formData.append('image', new File([blob], 'garment.jpg', { type: 'image/jpeg' }));
    try {
      const item = await createItem.mutateAsync(formData);
      return item.id;
    } catch (e) {
      const existing = e instanceof ApiError && e.status === 409 ? DUPLICATE_ID.exec(e.message) : null;
      if (existing) return existing[1];
      throw e;
    }
  };

  const handleLog = async () => {
    setSaving(true);
    try {
      const ids: string[] = [];
      for (let index = 0; index < choices.length; index++) {
        const choice = choices[index];
        if (choice.kind === 'item') ids.push(choice.itemId);
        else if (choice.kind === 'new') ids.push(await idForNewGarment(garments[index]));
      }
      await createOutfit.mutateAsync({
        items: Array.from(new Set(ids)),
        occasion,
        scheduled_for: date,
        mark_worn: true,
      });
      toast.success(t('logged'));
      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e, t('logFailed')));
    } finally {
      setSaving(false);
    }
  };

  const setChoice = (index: number, choice: Choice) =>
    setChoices((all) => all.map((c, i) => (i === index ? choice : c)));

  const itemCount = chosenItemIds(choices).length + newItemCount(choices);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && !saving && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('privacy')}</DialogDescription>
        </DialogHeader>

        {step === 'pick' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('description')}</p>
            <Input
              type="file"
              accept={ACCEPTED_IMAGE_INPUT}
              aria-label={t('choosePhoto')}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = '';
              }}
            />
          </div>
        )}

        {step === 'crop' && photo && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{t('cropTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('cropHint')}</p>
            <div className="flex justify-center rounded-md bg-muted p-2">
              <BoxFrame
                imageUrl={photo.url}
                alt={t('photoAlt')}
                box={crop}
                onChange={setCrop}
                label={t('cropBox')}
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="face-confirmed"
                checked={faceConfirmed}
                onCheckedChange={(checked) => setFaceConfirmed(checked === true)}
              />
              <Label htmlFor="face-confirmed" className="text-sm font-normal">
                {t('faceConfirm')}
              </Label>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep('pick')}>
                {t('back')}
              </Button>
              <Button disabled={!faceConfirmed} onClick={handleContinue}>
                {t('continue')}
              </Button>
            </div>
          </div>
        )}

        {step === 'matching' && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t('matching')}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-4">
            {garments.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t('noneFound')}</p>
                <Button variant="outline" onClick={() => setStep('crop')}>
                  {t('back')}
                </Button>
              </div>
            ) : (
              <>
                <ul className="space-y-4">
                  {garments.map((garment, index) => {
                    const choice = choices[index];
                    return (
                      <li key={index} className="space-y-2 rounded-md border p-3">
                        <div className="flex items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumbs[index]}
                            alt=""
                            className="h-16 w-16 rounded object-cover"
                          />
                          <div className="text-sm">
                            <p className="font-medium">{t('garmentLabel', { number: index + 1 })}</p>
                            <p className="text-muted-foreground">{typeLabel(garment.type)}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {garment.candidates.map((candidate) => {
                            const option: Choice = { kind: 'item', itemId: candidate.item_id };
                            const selected = sameChoice(choice, option);
                            return (
                              <button
                                key={candidate.item_id}
                                type="button"
                                aria-pressed={selected}
                                aria-label={candidate.name || typeLabel(candidate.type)}
                                onClick={() => setChoice(index, option)}
                                className={`w-20 rounded border-2 p-1 text-center text-xs ${
                                  selected ? 'border-primary' : 'border-transparent hover:border-muted-foreground/50'
                                }`}
                              >
                                {candidate.thumbnail_url && (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={candidate.thumbnail_url}
                                    alt=""
                                    className="mb-1 h-16 w-full rounded object-cover"
                                  />
                                )}
                                <span className="line-clamp-2">
                                  {candidate.name || typeLabel(candidate.type)}
                                </span>
                              </button>
                            );
                          })}
                          {garment.candidates.length === 0 && (
                            <p className="self-center text-xs text-muted-foreground">{t('noCandidates')}</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={choice?.kind === 'new' ? 'secondary' : 'outline'}
                            aria-pressed={choice?.kind === 'new'}
                            onClick={() => setChoice(index, { kind: 'new' })}
                          >
                            {t('addAsNew')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={choice?.kind === 'skip' ? 'secondary' : 'outline'}
                            aria-pressed={choice?.kind === 'skip'}
                            onClick={() => setChoice(index, { kind: 'skip' })}
                          >
                            {t('skip')}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="photo-occasion">{t('occasion')}</Label>
                    <select
                      id="photo-occasion"
                      value={occasion}
                      onChange={(e) => setOccasion(e.target.value)}
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                    >
                      {occasions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="photo-date">{t('date')}</Label>
                    <Input
                      id="photo-date"
                      type="date"
                      value={date}
                      max={today()}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </div>
                </div>

                {!canLogOutfit(choices) && (
                  <p className="text-xs text-muted-foreground">{t('needOne')}</p>
                )}
                <div className="flex justify-between gap-2">
                  <Button variant="ghost" onClick={() => setStep('crop')} disabled={saving}>
                    {t('back')}
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>
                      {tc('cancel')}
                    </Button>
                    <Button disabled={!canLogOutfit(choices) || saving || !date} onClick={handleLog}>
                      {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {t('logButton', { count: itemCount })}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
