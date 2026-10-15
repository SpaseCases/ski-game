// Every map the map-select menu offers, in the order it shows them. Map
// files are fetched only when picked. Maps still being built have no loader
// and show as "coming soon".

export type MapId = 'park' | 'freeride' | 'slalom' | 'bigair' | 'test';

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
    blurb: 'A huge terrain park: jump lines from small to huge, rails and boxes, two halfpipes and one very long rail.',
    load: () => import('./park.json').then((m) => m.default),
  },
  {
    id: 'freeride',
    name: 'Freeride',
    blurb: 'A big open mountain with bowls, cliffs, chutes and tree runs.',
  },
  {
    id: 'slalom',
    name: 'Slalom',
    blurb: 'Two timed courses: a tight slalom and a fast giant slalom.',
  },
  {
    id: 'bigair',
    name: 'Big air',
    blurb: 'Big jumps side by side, from long and mellow to steep and poppy.',
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
