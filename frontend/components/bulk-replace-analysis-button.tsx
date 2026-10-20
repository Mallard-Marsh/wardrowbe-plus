'use client';

import { Loader2, Replace } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface BulkReplaceAnalysisButtonProps {
  count: number;
  pending?: boolean;
  onConfirm: () => void;
}

// Toolbar button that asks before the AI redoes its tags for every selected item. The tags a
// person edited are kept; everything else the AI guessed earlier is replaced.
export function BulkReplaceAnalysisButton({ count, pending = false, onConfirm }: BulkReplaceAnalysisButtonProps) {
  const t = useTranslations('common');
  const tWardrobe = useTranslations('wardrobe');

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={pending}
          aria-label={t('bulkActions.reanalyzeAndReplace')}
          title={t('bulkActions.reanalyzeAndReplace')}
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Replace className="h-4 w-4" />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {tWardrobe('bulkActions.reanalyzeAndReplaceConfirmTitle', { count })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {tWardrobe('bulkActions.reanalyzeAndReplaceConfirmDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {tWardrobe('bulkActions.reanalyzeAndReplaceConfirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
