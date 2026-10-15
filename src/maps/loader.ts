import type { Feature, FinishDef, FlagDef, MapDef, RollersDef, TerrainDef } from './types.ts';

/**
 * Checks raw JSON against the map format and returns a typed MapDef.
 * Throws with the offending path so a broken map file is easy to find.
 */
export function parseMap(raw: unknown): MapDef {
  const map = obj(raw, 'map');
  const colors = obj(map.colors, 'colors');
  const spawn = obj(map.spawn, 'spawn');
  const features = map.features;
  if (!Array.isArray(features)) throw new Error('Map: features must be an array');
  const flags = map.flags;
  if (!Array.isArray(flags)) throw new Error('Map: flags must be an array');

  return {
    name: str(map.name, 'name'),
    terrain: parseTerrain(map.terrain),
    features: features.map((f, i) => parseFeature(f, `features[${i}]`)),
    spawn: {
      x: num(spawn.x, 'spawn.x'),
      z: num(spawn.z, 'spawn.z'),
      heading: num(spawn.heading, 'spawn.heading'),
    },
    flags: flags.map((f, i) => parseFlag(f, `flags[${i}]`)),
    finish: parseFinish(map.finish),
    colors: {
      sky: str(colors.sky, 'colors.sky'),
      fog: str(colors.fog, 'colors.fog'),
    },
  };
}

function parseTerrain(raw: unknown): TerrainDef {
  const t = obj(raw, 'terrain');
  if (t.type !== 'generated') throw new Error(`Map: unknown terrain type ${String(t.type)}`);
  const n = (key: string): number => num(t[key], `terrain.${key}`);
  return {
    type: 'generated',
    width: n('width'),
    length: n('length'),
    cellSize: n('cellSize'),
    slopeDeg: n('slopeDeg'),
    flatTop: n('flatTop'),
    runout: n('runout'),
    bermWidth: n('bermWidth'),
    bermHeight: n('bermHeight'),
    noise: n('noise'),
    seed: n('seed'),
    rollers: t.rollers === undefined ? undefined : parseRollers(t.rollers),
  };
}

function parseRollers(raw: unknown): RollersDef {
  const r = obj(raw, 'terrain.rollers');
  const n = (key: string): number => num(r[key], `terrain.rollers.${key}`);
  return { start: n('start'), end: n('end'), amplitude: n('amplitude'), spacing: n('spacing') };
}

function parseFlag(raw: unknown, path: string): FlagDef {
  const f = obj(raw, path);
  const n = (key: string): number => num(f[key], `${path}.${key}`);
  return { x: n('x'), z: n('z'), heading: n('heading'), width: n('width') };
}

function parseFinish(raw: unknown): FinishDef {
  const f = obj(raw, 'finish');
  const n = (key: string): number => num(f[key], `finish.${key}`);
  return { x: n('x'), z: n('z'), heading: n('heading'), width: n('width'), length: n('length') };
}

function parseFeature(raw: unknown, path: string): Feature {
  const f = obj(raw, path);
  const n = (key: string): number => num(f[key], `${path}.${key}`);
  switch (f.type) {
    case 'box':
      return {
        type: 'box',
        x: n('x'),
        z: n('z'),
        length: n('length'),
        width: n('width'),
        height: n('height'),
        yaw: n('yaw'),
      };
    case 'jump':
      return {
        type: 'jump',
        x: n('x'),
        z: n('z'),
        yaw: n('yaw'),
        width: n('width'),
        sideWidth: n('sideWidth'),
        lipHeight: n('lipHeight'),
        lipAngle: n('lipAngle'),
        deckLength: n('deckLength'),
        landingLength: n('landingLength'),
      };
    case 'rail': {
      const points = f.points;
      if (!Array.isArray(points) || points.length < 2) {
        throw new Error(`Map: ${path}.points must be an array of at least 2 points`);
      }
      return {
        type: 'rail',
        points: points.map((raw, i) => {
          const pt = obj(raw, `${path}.points[${i}]`);
          const m = (key: string): number => num(pt[key], `${path}.points[${i}].${key}`);
          return { x: m('x'), z: m('z'), height: m('height') };
        }),
      };
    }
    default:
      throw new Error(`Map: ${path} has unknown type ${String(f.type)}`);
  }
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Map: ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Map: ${path} must be a number`);
  }
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`Map: ${path} must be a string`);
  return value;
}
