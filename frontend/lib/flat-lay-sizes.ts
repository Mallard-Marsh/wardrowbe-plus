/**
 * Typical length in cm of a garment's longest side as it lies flat.
 *
 * A photo's pixel size is meaningless (each photo is taken at a different distance), so the
 * flat-lay layout sizes every item by its real-world length instead and uses one shared scale
 * for the whole picture. These are estimates; they live in one table so they are easy to tune.
 */
export const GARMENT_LONG_SIDE_CM: Record<string, number> = {
  't-shirt': 70,
  shirt: 75,
  polo: 70,
  blouse: 70,
  top: 65,
  'tank-top': 65,
  pants: 105,
  jeans: 105,
  shorts: 50,
  skirt: 60,
  dress: 110,
  jumpsuit: 140,
  jacket: 75,
  blazer: 75,
  coat: 105,
  suit: 80,
  vest: 60,
  cardigan: 70,
  sweater: 72,
  hoodie: 72,
  shoes: 30,
  sneakers: 30,
  boots: 32,
  sandals: 28,
  socks: 25,
  tights: 80,
  tie: 55,
  hat: 28,
  scarf: 60,
  belt: 90,
  bag: 35,
  accessories: 15,
};

/** What a type not in the table is assumed to be. */
export const DEFAULT_LONG_SIDE_CM = 30;

export function longSideCm(type: string): number {
  return GARMENT_LONG_SIDE_CM[type] ?? DEFAULT_LONG_SIDE_CM;
}
