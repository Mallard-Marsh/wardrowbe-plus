'use client';

import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  usePatternLabel,
  useStyleLabel,
  useSeasonLabel,
  useFitLabel,
  useMaterialLabel,
  useFormalityLabel,
} from '@/lib/hooks/use-translated-constants';
import { useClothingColors, useColorLabel } from '@/lib/hooks/use-translated-constants';
import { CLOTHING_COLORS } from '@/lib/generated/garment-vocabulary';
import { ItemTags } from '@/lib/types';

const PATTERN_VALUES = ['solid', 'striped', 'plaid', 'checkered', 'floral', 'graphic', 'geometric', 'polka-dot', 'camouflage', 'animal-print'] as const;
const MATERIAL_VALUES = ['cotton', 'denim', 'leather', 'wool', 'polyester', 'silk', 'linen', 'knit', 'fleece', 'suede', 'velvet', 'nylon', 'canvas', 'down', 'shearling'] as const;
const FORMALITY_VALUES = ['very-casual', 'casual', 'smart-casual', 'business-casual', 'formal', 'very-formal'] as const;
const FIT_VALUES = ['slim', 'regular', 'relaxed', 'oversized', 'tailored', 'cropped'] as const;
const STYLE_VALUES = ['casual', 'classic', 'sporty', 'minimalist', 'bohemian', 'preppy', 'streetwear', 'elegant', 'athletic', 'vintage', 'modern', 'rugged'] as const;
const SEASON_VALUES = ['spring', 'summer', 'fall', 'winter', 'all-season'] as const;

interface ItemTagsEditorProps {
  tags: ItemTags;
  onSave: (tags: Partial<ItemTags>) => void;
  disabled?: boolean;
}

export function ItemTagsEditor({ tags, onSave, disabled = false }: ItemTagsEditorProps) {
  const patternLabel = usePatternLabel();
  const styleLabel = useStyleLabel();
  const seasonLabel = useSeasonLabel();
  const fitLabel = useFitLabel();
  const materialLabel = useMaterialLabel();
  const formalityLabel = useFormalityLabel();
  const clothingColors = useClothingColors();
  const colorLabel = useColorLabel();

  const [pattern, setPattern] = useState(tags.pattern ?? '');
  const [material, setMaterial] = useState(tags.material ?? '');
  const [formality, setFormality] = useState(tags.formality ?? '');
  const [fit, setFit] = useState(tags.fit ?? '');
  const [styleOptions, setStyleOptions] = useState<string[]>(tags.style ?? []);
  const [seasonOptions, setSeasonOptions] = useState<string[]>(tags.season ?? []);
  // Colour order: first = primary (kept in step with primary_color), then secondary, tertiary.
  const [colourOrder, setColourOrder] = useState<string[]>(tags.colors ?? []);

  const primaryColor = tags.primary_color;
  const colorInfo = clothingColors.find((c) => c.value === primaryColor);

  const handleSave = () => {
    const next: Partial<ItemTags> = {};
    // Only send keys the user actually changed, so a partial update never
    # wipes tags the user didn't touch.
    if (pattern !== tags.pattern) next.pattern = pattern || undefined;
    if (material !== tags.material) next.material = material || undefined;
    if (formality !== tags.formality) next.formality = formality || undefined;
    if (fit !== tags.fit) next.fit = fit || undefined;
    if (JSON.stringify(styleOptions) !== JSON.stringify(tags.style ?? []))
      next.style = styleOptions;
    if (JSON.stringify(seasonOptions) !== JSON.stringify(tags.season ?? []))
      next.season = seasonOptions;
    if (JSON.stringify(colourOrder) !== JSON.stringify(tags.colors ?? []))
      next.colors = colourOrder;
    // Keep primary_color in step with the first colour in the list.
    if (colourOrder.length > 0 && colourOrder[0] !== primaryColor) {
      next.primary_color = colourOrder[0];
    }
    onSave(next);
  };

  return (
    <div className="space-y-4 pt-2 border-t">
      <div className="space-y-2">
        <Label>Pattern</Label>
        <Select
          value={pattern}
          onValueChange={(v) => setPattern(v ?? '')}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={pattern ? patternLabel(pattern) : 'Select a pattern'} />
          </SelectTrigger>
          <SelectContent>
            {PATTERN_VALUES.map((p) => (
              <SelectItem key={p} value={p}>
                {patternLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Material</Label>
        <Select
          value={material}
          onValueChange={(v) => setMaterial(v ?? '')}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={material ? materialLabel(material) : 'Select a material'} />
          </SelectTrigger>
          <SelectContent>
            {MATERIAL_VALUES.map((m) => (
              <SelectItem key={m} value={m}>
                {materialLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Formality</Label>
        <Select
          value={formality}
          onValueChange={(v) => setFormality(v ?? '')}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={formality ? formalityLabel(formality) : 'Select a formality'} />
          </SelectTrigger>
          <SelectContent>
            {FORMALITY_VALUES.map((f) => (
              <SelectItem key={f} value={f}>
                {formalityLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Fit</Label>
        <Select
          value={fit}
          onValueChange={(v) => setFit(v ?? '')}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={fit ? fitLabel(fit) : 'Select a fit'} />
          </SelectTrigger>
          <SelectContent>
            {FIT_VALUES.map((f) => (
              <SelectItem key={f} value={f}>
                {fitLabel(f)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Style</Label>
        <div className="flex flex-wrap gap-1.5">
          {STYLE_VALUES.map((s) => (
            <Button
              key={s}
              variant={styleOptions.includes(s) ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                const next = styleOptions.includes(s) ? styleOptions.filter((x) => x !== s) : [...styleOptions, s];
                setStyleOptions(next);
              }}
              disabled={disabled}
            >
              {styleLabel(s)}
            </Button>
          ))}
        </div>
        {styleOptions.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {styleOptions.map((s) => styleLabel(s)).join(' • ')}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Season</Label>
        <div className="flex flex-wrap gap-1.5">
          {SEASON_VALUES.map((s) => (
            <Button
              key={s}
              variant={seasonOptions.includes(s) ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                const next = seasonOptions.includes(s) ? seasonOptions.filter((x) => x !== s) : [...seasonOptions, s];
                setSeasonOptions(next);
              }}
              disabled={disabled}
            >
              {seasonLabel(s)}
            </Button>
          ))}
        </div>
        {seasonOptions.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {seasonOptions.map((s) => seasonLabel(s)).join(' • ')}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Colours</Label>
        <div className="flex gap-1.5">
          {colourOrder.map((c, i) => {
            const color = clothingColors.find((x) => x.value === c);
            const isPrimary = i === 0;
            return (
              <div key={c} className="flex items-center gap-1.5 border rounded-md p-1.5 bg-white/40">
                <Badge variant={isPrimary ? 'primary' : 'secondary'} className="text-xs">
                  {isPrimary ? 'Primary' : `Colour ${i + 1}`}
                </Badge>
                {color && (
                  <div className="w-3 h-3 rounded-full border" style={{ backgroundColor: color.hex }} />
                )}
                <span className="text-xs">{colorLabel(c)}</span>
                {i < colourOrder.length - 1 && (
                  <Button variant="outline" size="icon" onClick={() => moveColour(i, -1)} disabled={disabled}>
                    <ChevronLeft />
                  </Button>
                )}
                {i > 0 && (
                  <Button variant="outline" size="icon" onClick={() => moveColour(i, 1)} disabled={disabled}>
                    <ChevronRight />
                  </Button>
                )}
                <Button variant="destructive" size="icon" onClick={() => removeColour(i)} disabled={disabled}>
                  <Trash2 />
                </Button>
              </div>
            );
          })}
          {colourOrder.length < 3 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => addColour()}
              disabled={disabled}
            >
              <Plus className="mr-2" /> Add colour
            </Button>
          )}
        </div>
        {colourOrder.length > 0 && (
          <p className="text-xs text-muted-foreground">
            First colour is used as the item's primary colour.
          </p>
        )}
      </div>

      <Button
        variant="default"
        onClick={handleSave}
        disabled={disabled}
      >
        Save tags
      </Button>
    </div>
  );

  function moveColour(index: number, direction: number) {
    setColourOrder((prev) => {
      const next = [...prev];
      const from = index;
      const to = index + direction;
      if (to < 0 || to >= next.length) return next;
      next[from] = next[to];
      next[to] = prev[from];
      return next;
    });
  }

  function removeColour(index: number) {
    setColourOrder((prev) => prev.filter((_, i) => i !== index));
  }

  function addColour() {
    setColourOrder((prev) => {
      const next = [...prev];
      const last = next.length > 0 ? next[next.length - 1] : clothingColors[0].value;
      // Pick a colour different from the last one.
      let candidate = clothingColors[0].value;
      for (const c of clothingColors) {
        if (c.value !== last) {
          candidate = c.value;
          break;
        }
      }
      next.push(candidate);
      return next;
    });
  }
}
