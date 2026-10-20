import { useEffect, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/hooks/query-keys';
import { applySessionToken, useSetTokenIfAvailable } from '@/lib/hooks/use-session-token';
import type { Outfit, OutfitItem } from '@/lib/types';

interface CutoutsPrepared {
  ready: number;
  queued: number;
  item_ids: string[];
}

const POLL_MS = 2500;
// A cut-out takes seconds once the model is loaded and up to a minute on the first one after a
// restart; past this the missing ones are drawn from their photos instead.
const GIVE_UP_AFTER_POLLS = 40;

export function hasCutout(item: OutfitItem): boolean {
  return !!item.cutout_url;
}

/**
 * Items of an outfit with their cut-outs, asking the server to make the missing ones.
 *
 * Only the outfit's owner can have cut-outs made; for anyone else the items passed in are used as
 * they are. `preparing` is true while cut-outs are being made; `failed` once some are still missing
 * and waiting is over, when those items are drawn from their photos instead.
 */
export function useFlatLayItems(
  outfitId: string,
  fallback: OutfitItem[],
  enabled: boolean,
  isOwner: boolean,
) {
  const { data: session, status } = useSession();
  useSetTokenIfAvailable();
  const polls = useRef(0);
  const asked = useRef(false);

  const prepare = useMutation({
    mutationFn: () => {
      applySessionToken(session);
      return api.post<CutoutsPrepared>(`/outfits/${outfitId}/flat-lay/cutouts`);
    },
  });

  const outfit = useQuery({
    queryKey: queryKeys.flatLayOutfit(outfitId),
    queryFn: () => {
      polls.current += 1;
      return api.get<Outfit>(`/outfits/${outfitId}`);
    },
    enabled: enabled && isOwner && status !== 'loading',
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const waiting = items.some((i) => !hasCutout(i)) && prepare.isSuccess;
      return waiting && polls.current < GIVE_UP_AFTER_POLLS ? POLL_MS : false;
    },
    gcTime: 0,
  });

  const canPrepare = isOwner && !outfit.isError;
  const items = outfit.data?.items ?? fallback;
  const missing = items.some((i) => !hasCutout(i));
  const gaveUp = polls.current >= GIVE_UP_AFTER_POLLS;

  const { mutate } = prepare;
  useEffect(() => {
    // Wait for the first read of the outfit, so a picture that is already complete never
    // queues anything.
    if (!enabled || !canPrepare || asked.current || !outfit.isSuccess || !missing) return;
    asked.current = true;
    mutate();
  }, [enabled, canPrepare, outfit.isSuccess, missing, mutate]);

  const preparing =
    enabled &&
    canPrepare &&
    (outfit.isLoading || (missing && !prepare.isError && !gaveUp));
  return { items, preparing, failed: enabled && missing && !preparing };
}
