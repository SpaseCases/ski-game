import type {
  AreaDef,
  DecorDef,
  Feature,
  FinishDef,
  FlagDef,
  HeightPoint,
  LineKind,
  MapDef,
  PeakTerrainDef,
  PitchSection,
  PropKind,
  RailPoint,
  Ramp4,
  RollersDef,
  RunDef,
  ScatterKind,
  SpokeDef,
  StartStyle,
  TerrainDef,
  TerrainElement,
  TerrainLane,
  XZ,
} from './types.ts';

const SCATTER_KINDS: readonly ScatterKind[] = ['pine', 'aspen', 'snag', 'rock', 'boulder'];
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
    finishes: nonEmpty(map.finishes, 'finishes').map((f, i) => parseFinish(f, `finishes[${i}]`)),
    decor: map.decor === undefined ? [] : arr(map.decor, 'decor').map((d, i) => parseDecor(d, `decor[${i}]`)),
    runs: map.runs === undefined ? [] : arr(map.runs, 'runs').map((r, i) => parseRun(r, `runs[${i}]`)),
    colors: {
      sky: str(colors.sky, 'colors.sky'),
      fog: str(colors.fog, 'colors.fog'),
    },
  };
}

function parseTerrain(raw: unknown): TerrainDef {
  const t = obj(raw, 'terrain');
  if (t.type === 'peak') return parsePeak(t);
  if (t.type !== 'generated') throw new Error(`Map: unknown terrain type ${String(t.type)}`);
  const n = reader(t, 'terrain');
  const profile = t.profile === undefined ? undefined : sections(t.profile, 'terrain.profile', false);
  // A profile replaces the straight slope's numbers.
  const straight = profile ? 0 : undefined;
  return {
    type: 'generated',
    width: n('width'),
    length: n('length'),
    cellSize: n('cellSize'),
    slopeDeg: n('slopeDeg', straight),
    flatTop: n('flatTop', straight),
    runout: n('runout', straight),
    profile,
    lanes: t.lanes === undefined ? undefined : arr(t.lanes, 'terrain.lanes').map((l, i) => parseLane(l, `terrain.lanes[${i}]`)),
    bermWidth: n('bermWidth'),
    bermHeight: n('bermHeight'),
    noise: n('noise'),
    seed: n('seed'),
    rollers: t.rollers === undefined ? undefined : parseRollers(t.rollers),
    margin: n('margin', 0),
  };
}

function parsePeak(t: Record<string, unknown>): PeakTerrainDef {
  const n = reader(t, 'terrain');
  const r = reader(obj(t.roll, 'terrain.roll'), 'terrain.roll');
  const f = reader(obj(t.relief, 'terrain.relief'), 'terrain.relief');
  const m = reader(obj(t.rim, 'terrain.rim'), 'terrain.rim');
  return {
    type: 'peak',
    size: n('size'),
    cellSize: n('cellSize'),
    summit: n('summit'),
    spokes: nonEmpty(t.spokes, 'terrain.spokes').map((s, i) => parseSpoke(s, `terrain.spokes[${i}]`)),
    roll: { amplitude: r('amplitude'), wavelength: r('wavelength') },
    relief: { amplitude: f('amplitude'), wavelength: f('wavelength') },
    elements: arr(t.elements, 'terrain.elements').map((e, i) => parseElement(e, `terrain.elements[${i}]`)),
    bounds: xzPoints(t.bounds, 'terrain.bounds', 3),
    rim: { inset: m('inset'), ramp: m('ramp'), rise: m('rise') },
    rockSlope: n('rockSlope', 50),
    noise: n('noise'),
    rockNoise: n('rockNoise', 0),
    seed: n('seed'),
  };
}

function parseSpoke(raw: unknown, path: string): SpokeDef {
  const o = obj(raw, path);
  const n = reader(o, path);
  return {
    name: str(o.name, `${path}.name`),
    heading: n('heading'),
    bend: n('bend', 0),
    sharp: n('sharp', 0),
    sharpTo: n('sharpTo', 600),
    sections: sections(o.sections, `${path}.sections`, false),
  };
}

function parseElement(raw: unknown, path: string): TerrainElement {
  const e = obj(raw, path);
  const n = reader(e, path);
  switch (e.type) {
    case 'ridge':
      return { type: 'ridge', points: heightPoints(e.points, `${path}.points`), crest: n('crest'), side: n('side'), taper: n('taper', 20) };
    case 'gully':
      return { type: 'gully', points: xzPoints(e.points, `${path}.points`, 2), floor: n('floor'), depth: n('depth'), wall: n('wall'), taper: n('taper', 30) };
    case 'cliffs': {
      const points = heightPoints(e.points, `${path}.points`);
      const tallest = Math.max(...points.map((p) => p.height));
      return { type: 'cliffs', points, heading: n('heading'), face: n('face', 3), bench: n('bench', 4 * tallest + 8), taper: n('taper', 12) };
    }
    case 'lip':
      return {
        type: 'lip',
        points: xzPoints(e.points, `${path}.points`, 2),
        heading: n('heading'),
        height: n('height'),
        ramp: n('ramp'),
        drop: n('drop'),
        taper: n('taper', 15),
      };
    case 'bowl':
      return {
        type: 'bowl',
        x: n('x'),
        z: n('z'),
        heading: n('heading'),
        length: n('length'),
        width: n('width'),
        depth: n('depth'),
        head: n('head'),
        exit: n('exit'),
        rim: n('rim'),
      };
    case 'pillows':
      return {
        type: 'pillows',
        x: n('x'),
        z: n('z'),
        heading: n('heading'),
        width: n('width'),
        length: n('length'),
        count: n('count'),
        size: pair(e.size, `${path}.size`),
        height: pair(e.height, `${path}.height`),
        seed: n('seed', 1),
      };
    case 'bumps':
      return {
        type: 'bumps',
        x: n('x'),
        z: n('z'),
        radius: n('radius'),
        fade: n('fade'),
        amplitude: n('amplitude'),
        wavelength: n('wavelength'),
        seed: n('seed', 1),
      };
    case 'dip':
      return { type: 'dip', x: n('x'), z: n('z'), radius: n('radius'), depth: n('depth') };
    case 'flat':
      return {
        type: 'flat',
        x: n('x'),
        z: n('z'),
        heading: n('heading', 0),
        pitch: n('pitch', 0),
        radius: n('radius', 0),
        width: n('width', 0),
        length: n('length', 0),
        blend: n('blend'),
      };
    default:
      throw new Error(`Map: ${path} has unknown type ${String(e.type)}`);
  }
}

/** Pitch sections; `solveLast` lets the last one leave its pitch out. */
function sections(raw: unknown, path: string, solveLast: boolean): PitchSection[] {
  const list = arr(raw, path);
  if (list.length === 0) throw new Error(`Map: ${path} needs at least one section`);
  return list.map((s, i) => {
    const p = `${path}[${i}]`;
    const o = obj(s, p);
    const m = reader(o, p);
    const length = m('length');
    if (!(length > 0)) throw new Error(`Map: ${p}.length must be more than 0`);
    const solved = solveLast && i === list.length - 1 && o.pitch === undefined;
    return { length, pitch: solved ? undefined : m('pitch'), ease: m('ease', 20) };
  });
}

function parseLane(raw: unknown, path: string): TerrainLane {
  const o = obj(raw, path);
  const n = reader(o, path);
  return {
    x: n('x'),
    width: n('width'),
    blend: n('blend', 20),
    start: n('start'),
    sections: sections(o.sections, `${path}.sections`, true),
    endEase: n('endEase', 20),
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

function parseFinish(raw: unknown, path: string): FinishDef {
  const n = reader(obj(raw, path), path);
  return { x: n('x'), z: n('z'), heading: n('heading'), width: n('width'), length: n('length') };
}

function parseRun(raw: unknown, path: string): RunDef {
  const o = obj(raw, path);
  return { name: str(o.name, `${path}.name`), points: xzPoints(o.points, `${path}.points`, 2), clear: reader(o, path)('clear', 0) };
}

function parseFeature(raw: unknown, path: string): Feature {
  const f = obj(raw, path);
  const n = reader(f, path);
  switch (f.type) {
    case 'box':
      return { type: 'box', width: n('width'), points: railPoints(f.points, `${path}.points`), follow: n('follow', 0) };
    case 'rail':
      return { type: 'rail', points: railPoints(f.points, `${path}.points`), follow: n('follow', 0) };
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

function heightPoints(raw: unknown, path: string): HeightPoint[] {
  return railPoints(raw, path);
}

/** Two numbers, low then high. */
function pair(raw: unknown, path: string): [number, number] {
  const list = arr(raw, path);
  if (list.length !== 2) throw new Error(`Map: ${path} must be [low, high]`);
  return [num(list[0], `${path}[0]`), num(list[1], `${path}[1]`)];
}

/** Four rising numbers: a terrain placement range. */
function ramp4(raw: unknown, path: string): Ramp4 {
  const list = arr(raw, path);
  if (list.length !== 4) throw new Error(`Map: ${path} must be four numbers`);
  const r = list.map((v, i) => num(v, `${path}[${i}]`)) as Ramp4;
  if (!(r[0] <= r[1] && r[1] <= r[2] && r[2] <= r[3])) throw new Error(`Map: ${path} must rise from first to last`);
  return r;
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
  if ((SCATTER_KINDS as readonly string[]).includes(kind) && d.spacing !== undefined) {
    const clumps = d.clumps === undefined ? undefined : reader(obj(d.clumps, `${path}.clumps`), `${path}.clumps`);
    return {
      kind: kind as ScatterKind,
      spacing: n('spacing'),
      height: ramp4(d.height, `${path}.height`),
      slope: ramp4(d.slope, `${path}.slope`),
      clumps: { size: clumps ? clumps('size') : 100, clear: clumps ? clumps('clear') : 0 },
      seed: n('seed', 1),
      minScale: n('minScale', 0.8),
      maxScale: n('maxScale', 1.2),
      solid: d.solid === undefined ? false : bool(d.solid, `${path}.solid`),
      reach: n('reach', 450),
    };
  }
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

function nonEmpty(value: unknown, path: string): unknown[] {
  const list = arr(value, path);
  if (list.length === 0) throw new Error(`Map: ${path} needs at least one entry`);
  return list;
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
