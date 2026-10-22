import { useMutation } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { API_BASE_PATH, ApiError, NetworkError, getAccessToken } from '@/lib/api';
import type { PhotoGarment } from '@/lib/outfit-photo';

interface OutfitPhotoResponse {
  garments: PhotoGarment[];
}

/** Sends a (cropped) photo of the person; the server finds the garments and matches them to the
 *  wardrobe. Nothing is created and the photo is not kept. */
export function useMatchOutfitPhoto() {
  const { data: session } = useSession();

  return useMutation({
    mutationFn: async (photo: Blob): Promise<OutfitPhotoResponse> => {
      const token = session?.accessToken || getAccessToken();
      const formData = new FormData();
      formData.append('image', photo, 'outfit.jpg');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      let response: Response;
      try {
        response = await fetch(`${API_BASE_PATH}/outfits/from-photo`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
          headers,
        });
      } catch {
        throw new NetworkError('Unable to connect to server. Please try again.');
      }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(data.detail || 'Could not read the photo', response.status, data);
      }
      return response.json();
    },
  });
}
