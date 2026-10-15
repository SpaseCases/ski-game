import type {
  AreaDef,
  DecorDef,
  Feature,
  FinishDef,
  FlagDef,
  LineKind,
  MapDef,
  PropKind,
  RailPoint,
  RollersDef,
  ScatterKind,
  StartStyle,
  TerrainDef,
  XZ,
} from './types.ts';

const SCATTER_KINDS: readonly ScatterKind[] = ['pine', 'snag', 'rock', 'boulder'];
const LINE_KINDS: readonly LineKind[] = ['fence', 'netting', 'barrier', 'dyeLine', 'bunting', 'chairlift'];
const PROP_KINDS: readonly PropKind[] = ['lightPole', 'floodlight', 'banner', 'flag', 'groomer'];
const START_STYLES: readonly StartStyle[] = ['deck', 'tower', 'ridge', 'race'];

/**
 * Checks raw JSON against the map format and returns a typed MapDef, filling
 * in defaults for optional fields. Throws with the offending path so a broken
 * map file is easy to find.
 */
export function parseMap(raw: unknown): MapDef {
  const map = obj(raw, 'map');
  const colors = obj(map.colors, 'colors');
  const spawn = obj(map.spawn, 'spawn');

  return {
    name: str(map.name, 'name'),
    terrain: parseTerrain(map.terrain),
    features: arr(map.features, 'features').map((f, i) => parseFeature(f, `features[${i}]`)),
    spawn: {
      x: num(spawn.x, 'spawn.x'),
      z: num(spawn.z, 'spawn.z'),
      heading: num(spawn.heading, 'spawn.heading'),
    },
    flags: arr(map.flags, 'flags').map((f, i) => parseFlag(f, `flags[${i}]`)),
    finish: parseFinish(map.finish),
    decor: map.decor === undefined ? [] : arr(map.decor, 'decor').map((d, i) => parseDecor(d, `decor[${i}]`)),
    colors: {
      sky: str(colors.sky, 'colors.sky'),
      fog: str(colors.fog, 'colors.fog'),
    },
  };
}

function parseTerrain(raw: unknown): TerrainDef {
  const t = obj(raw, 'terrain');
  if (t.type !== 'generated') throw new Error(`Map: unknown terrain type ${String(t.type)}`);
  const n = reader(t, 'terrain');
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
    margin: n('margin', 0),
  };
}

function parseRollers(raw: unknown): RollersDef {
  const n = reader(obj(raw, 'terrain.rollers'), 'terrain.rollers');
  return { start: n('start'), end: n('end'), amplitude: n('amplitude'), spacing: n('spacing') };
}

function parseFlag(raw: unknown, path: string): FlagDef {
  const n = reader(obj(raw, path), path);
  return { x: n('x'), z: n('z'), heading: n('heading'), width: n('width') };
}

function parseFinish(raw: unknown): FinishDef {
  const n = reader(obj(raw, 'finish'), 'finish');
  return { x: n('x'), z: n('z'), heading: n('heading'), width: n('width'), length: n('length') };
}

function parseFeature(raw: unknown, path: string): Feature {
  const f = obj(raw, path);
  const n = reader(f, path);
  switch (f.type) {
    case 'box':
      return { type: 'box', width: n('width'), points: railPoints(f.points, `${path}.points`) };
    case 'rail':
      return { type: 'rail', points: railPoints(f.points, `${path}.points`) };
    case 'jump': {
      const lipHeight = n('lipHeight');
      const deck = f.deck === undefined ? true : bool(f.deck, `${path}.deck`);
      return {
        type: 'jump',
        x: n('x'),
        z: n('z'),
        yaw: n('yaw', 0),
        width: n('width'),
        sideWidth: n('sideWidth'),
        lipHeight,
        lipAngle: n('lipAngle'),
        gap: n('gap'),
        deck,
        landingHeight: deck ? lipHeight : n('landingHeight', lipHeight),
        landingAngle: n('landingAngle'),
        knuckle: n('knuckle', 3),
        transition: n('transition', 5),
      };
    }
    case 'kicker': {
      const lipHeight = n('lipHeight');
      return {
        type: 'kicker',
        x: n('x'),
        z: n('z'),
        yaw: n('yaw', 0),
        width: n('width'),
        sideWidth: n('sideWidth'),
        lipHeight,
        lipAngle: n('lipAngle'),
        back: n('back', Math.max(1, 1.2 * lipHeight)),
      };
    }
    case 'landing': {
      const height = n('height');
      return {
        type: 'landing',
        x: n('x'),
        z: n('z'),
        yaw: n('yaw', 0),
        width: n('width'),
        sideWidth: n('sideWidth'),
        height,
        angle: n('angle'),
        back: n('back', Math.max(1, 1.2 * height)),
        top: n('top', 2),
        knuckle: n('knuckle', 3),
        transition: n('transition', 5),
      };
    }
    case 'halfpipe':
      return {
        type: 'halfpipe',
        x: n('x'),
        z: n('z'),
        yaw: n('yaw', 0),
        length: n('length'),
        floorWidth: n('floorWidth', 9),
        radius: n('radius', 5),
        wallAngle: n('wallAngle', 84),
        deckWidth: n('deckWidth', 3),
        outerWidth: n('outerWidth', 6),
        dropIn: n('dropIn', 6),
        entry: n('entry', 12),
        back: n('back', 30),
        exit: n('exit', 10),
      };
    case 'slalom':
      return {
        type: 'slalom',
        gates: arr(f.gates, `${path}.gates`).map((g, i) => {
          const m = reader(obj(g, `${path}.gates[${i}]`), `${path}.gates[${i}]`);
          return { x: m('x'), z: m('z'), heading: m('heading', 0), width: m('width', 6) };
        }),
      };
    case 'start': {
      const style = oneOf(f.style, START_STYLES, `${path}.style`);
      return {
        type: 'start',
        style,
        x: n('x'),
        z: n('z'),
        heading: n('heading', 0),
        height: n('height', style === 'tower' ? 7 : 0.6),
      };
    }
    default:
      throw new Error(`Map: ${path} has unknown type ${String(f.type)}`);
  }
}

function railPoints(raw: unknown, path: string): RailPoint[] {
  const points = arr(raw, path);
  if (points.length < 2) throw new Error(`Map: ${path} needs at least 2 points`);
  return points.map((p, i) => {
    const m = reader(obj(p, `${path}[${i}]`), `${path}[${i}]`);
    return { x: m('x'), z: m('z'), height: m('height') };
  });
}

function xzPoints(raw: unknown, path: string, min: number): XZ[] {
  const points = arr(raw, path);
  if (points.length < min) throw new Error(`Map: ${path} needs at least ${min} point(s)`);
  return points.map((p, i) => {
    const m = reader(obj(p, `${path}[${i}]`), `${path}[${i}]`);
    return { x: m('x'), z: m('z') };
  });
}

function parseDecor(raw: unknown, path: string): DecorDef {
  const d = obj(raw, path);
  const n = reader(d, path);
  const kind = str(d.kind, `${path}.kind`);
  if ((SCATTER_KINDS as readonly string[]).includes(kind)) {
    const a = reader(obj(d.area, `${path}.area`), `${path}.area`);
    const area: AreaDef = { x: a('x'), z: a('z'), width: a('width'), length: a('length') };
    return {
      kind: kind as ScatterKind,
      area,
      count: n('count'),
      seed: n('seed', 1),
      minScale: n('minScale', 0.8),
      maxScale: n('maxScale', 1.2),
      solid: d.solid === undefined ? false : bool(d.solid, `${path}.solid`),
    };
  }
  if ((LINE_KINDS as readonly string[]).includes(kind)) {
    return { kind: kind as LineKind, points: xzPoints(d.points, `${path}.points`, 2) };
  }
  if ((PROP_KINDS as readonly string[]).includes(kind)) {
    return {
      kind: kind as PropKind,
      points: xzPoints(d.points, `${path}.points`, 1),
      heading: n('heading', 0),
      color: d.color === undefined ? undefined : str(d.color, `${path}.color`),
    };
  }
  throw new Error(`Map: ${path} has unknown kind ${kind}`);
}

/** Reads numbers from an object; a fallback makes the field optional. */
function reader(o: Record<string, unknown>, path: string): (key: string, fallback?: number) => number {
  return (key, fallback) => (o[key] === undefined && fallback !== undefined ? fallback : num(o[key], `${path}.${key}`));
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Map: ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Map: ${path} must be an array`);
  return value;
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

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Map: ${path} must be true or false`);
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw new Error(`Map: ${path} must be one of ${options.join(', ')}`);
  }
  return value as T;
}
