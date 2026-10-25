// Every map the map-select menu offers, in the order it shows them. Map
// files are fetched only when picked. Maps still being built have no loader
// and show as "coming soon".

export type MapId = 'park' | 'jampark' | 'freeride' | 'slalom' | 'bigair' | 'test';

export interface MapEntry {
  id: MapId;
  name: string;
  blurb: string;
  /** Fetches the map file's JSON. Absent: not built yet. */
  load?: () => Promise<unknown>;
}

export const MAPS: readonly MapEntry[] = [
  {
    id: 'park',
    name: 'Park',
    blurb: 'A big terrain park: jump lines from small to huge, rails and boxes, two halfpipes and one very long rail.',
    load: () => import('./park.json').then((m) => m.default),
  },
  {
    id: 'jampark',
    name: 'Jam Park',
    blurb: 'A denser park built for combos: rails into jumps into rails, lines you can cut across, and two huge jumps sized for the speed you arrive with.',
    load: () => import('./jampark.json').then((m) => m.default),
  },
  {
    id: 'freeride',
    name: 'Freeride',
    blurb: 'Start on the summit and ride down any side: steep couloirs and cliffs, a corniced bowl, glades, and a long gully.',
    load: () => import('./freeride.json').then((m) => m.default),
  },
  {
    id: 'slalom',
    name: 'Slalom',
    blurb: 'Two timed courses side by side: a tight slalom and a fast giant slalom. Push through the wand to start the clock.',
    load: () => import('./slalom.json').then((m) => m.default),
  },
  {
    id: 'bigair',
    name: 'Big air',
    blurb: 'Drop in off the scaffold tower and pick a jump: a ski jump, a mellow table, a big 720 table, the massive one, a very steep lip, or an aerials kicker.',
    load: () => import('./bigair.json').then((m) => m.default),
  },
  {
    id: 'test',
    name: 'Test slope',
    blurb: 'Every feature side by side in four lanes, for trying things out.',
    load: () => import('./test-slope.json').then((m) => m.default),
  },
];

export function mapEntry(id: string | null): MapEntry | undefined {
  return MAPS.find((m) => m.id === id);
}
