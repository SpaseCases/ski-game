import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  Vector3,
  Vector4,
  type Material,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { CONFIG } from '../config.ts';
import { DECOR_SIZE, type DecorLayout } from '../maps/decor.ts';
import { smoothstep } from '../maps/terrain.ts';
import type { Heightfield } from '../maps/types.ts';
import { drawnHeightAt } from './terrainMesh.ts';

// Night lights, all faked (CLAUDE.md allows one sun and one sky light):
// - Pools of light: the world's surface materials (snow, features, rails,
//   decoration, start gates, gates and flags) get a few lines of vertex
//   shader that add light near up to CONFIG.lights.max pool centers, lit from each
//   lamp's height, so jumps facing the lamp light up and the slope beside
//   them falls off. One pool is the skier's headlamp, just ahead on the
//   snow; the rest are the nearest floodlights, light poles and street
//   lamps. The uniforms are shared by every material, so moving a pool is
//   one write; with no pools (by day) the loop ends at once.
// - Halos: a soft additive glow round each lamp, all of a map's in one
//   draw call of points.

/** The pool uniforms every patched material shares. */
const MAX = CONFIG.lights.max;
const shared = {
  poolCount: { value: 0 },
  /** Each pool's middle (xyz) and radius (w). */
  poolAt: { value: Array.from({ length: MAX }, () => new Vector4()) },
  /** Where each pool's light comes from. */
  poolFrom: { value: Array.from({ length: MAX }, () => new Vector3()) },
  /** Each pool's color times its strength (linear). */
  poolColor: { value: Array.from({ length: MAX }, () => new Vector3()) },
};

const VERTEX_PARS = /* glsl */ `
#define POOL_MAX ${MAX}
uniform int poolCount;
uniform vec4 poolAt[ POOL_MAX ];
uniform vec3 poolFrom[ POOL_MAX ];
uniform vec3 poolColor[ POOL_MAX ];
varying vec3 vPoolPos;
varying vec3 vPoolLight;
varying vec3 vPoolDir;`;
// The pools are summed per vertex (far fewer than pixels, so a weak GPU's
// pixel shading stays a few operations): their light, and the way it comes
// from, weighted by each pool's share. Each pixel then lights its facet by
// how squarely it faces that way (flat-shaded meshes carry no normals; the
// facet's comes from the position's slope across the pixel).
const VERTEX = /* glsl */ `
	vec4 poolWorld = vec4( transformed, 1.0 );
	#ifdef USE_INSTANCING
		poolWorld = instanceMatrix * poolWorld;
	#endif
	vPoolPos = ( modelMatrix * poolWorld ).xyz;
	vPoolLight = vec3( 0.0 );
	vPoolDir = vec3( 0.0 );
	for ( int i = 0; i < POOL_MAX; i ++ ) {
		if ( i >= poolCount ) break;
		vec3 d = vPoolPos - poolAt[ i ].xyz;
		float r2 = poolAt[ i ].w * poolAt[ i ].w;
		float dd = dot( d, d );
		if ( dd >= r2 ) continue;
		float f = 1.0 - dd / r2;
		f *= f;
		vPoolLight += poolColor[ i ] * f;
		vPoolDir += normalize( poolFrom[ i ] - vPoolPos ) * f;
	}`;
const FRAGMENT_PARS = /* glsl */ `
varying vec3 vPoolPos;
varying vec3 vPoolLight;
varying vec3 vPoolDir;`;
const FRAGMENT = /* glsl */ `
	{
		vec3 poolNormal = normalize( cross( dFdx( vPoolPos ), dFdy( vPoolPos ) ) );
		float facing = dot( poolNormal, vPoolDir ) / max( length( vPoolDir ), 1e-4 );
		outgoingLight += diffuseColor.rgb * vPoolLight * ( 0.2 + 0.8 * max( facing, 0.0 ) );
	}
	#include <envmap_fragment>`;

function patch(shader: WebGLProgramParametersWithUniforms): void {
  shader.uniforms.poolCount = shared.poolCount;
  shader.uniforms.poolAt = shared.poolAt;
  shader.uniforms.poolFrom = shared.poolFrom;
  shader.uniforms.poolColor = shared.poolColor;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>${VERTEX_PARS}`)
    .replace('#include <project_vertex>', `#include <project_vertex>${VERTEX}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>${FRAGMENT_PARS}`)
    .replace('#include <envmap_fragment>', FRAGMENT);
}

/** Lets the light pools fall on a (Lambert) material. Returns it. */
export function litByPools<T extends Material>(m: T): T {
  m.onBeforeCompile = patch;
  return m;
}

/** A lamp's pool: its middle and radius, where its light comes from, and its color times strength. */
interface Pool {
  at: Vector4;
  from: Vector3;
  color: Vector3;
}

type LampKind = 'floodlight' | 'lightPole' | 'streetLamp';

const haloMaterial = new ShaderMaterial({
  uniforms: {
    color: { value: new Color() },
    strength: { value: 0 },
    /** Fog start and end (m): halos fade out into it rather than glowing through. */
    fade: { value: [0, 1] },
    /** Pixels per meter at 1 m away (the viewport's height over the view's height there). */
    scale: { value: 1 },
  },
  vertexShader: /* glsl */ `
    attribute float size;
    uniform float scale;
    uniform vec2 fade;
    varying float vFade;
    void main() {
      vec4 mv = modelViewMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * mv;
      float dist = -mv.z;
      gl_PointSize = min( 160.0, size * scale / max( dist, 0.1 ) );
      vFade = 1.0 - smoothstep( fade.x, fade.y, dist );
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float strength;
    varying float vFade;
    void main() {
      vec2 c = gl_PointCoord * 2.0 - 1.0;
      float r = dot( c, c );
      if ( r > 1.0 ) discard;
      float glow = ( 1.0 - r ) * ( 1.0 - r );
      gl_FragColor = vec4( color * strength * vFade * glow, 1.0 );
    }`,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
});

/**
 * A map's night lights: every lamp's pool (from its light props), the
 * headlamp's, and the halos. update() picks the pools nearest the camera
 * each frame and writes them to the shared uniforms.
 */
export class LightPools {
  readonly halos: Points | null;
  private readonly pools: Pool[];
  private readonly hf: Heightfield;
  private on = 0;
  /** Scratch for picking the nearest pools: their indices and distances, nearest first. */
  private readonly pick: Int32Array;
  private readonly pickDist: Float64Array;

  constructor(layout: DecorLayout, hf: Heightfield) {
    this.hf = hf;
    this.pools = [];
    const halo: number[] = [];
    const sizes: number[] = [];
    const L = CONFIG.lights;
    const local = new Vector3();
    for (const p of layout.props) {
      if (p.kind !== 'floodlight' && p.kind !== 'lightPole' && p.kind !== 'streetLamp') continue;
      const kind: LampKind = p.kind;
      const def = L[kind];
      const yaw = (p.heading * Math.PI) / 180;
      // A prop faces local -Z, turned by its heading (as MeshKit.at turns it).
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      for (const at of p.points) {
        const ground = drawnHeightAt(hf, at.x, at.z);
        const cx = at.x + fx * def.ahead;
        const cz = at.z + fz * def.ahead;
        const c = new Color(def.color);
        this.pools.push({
          at: new Vector4(cx, drawnHeightAt(hf, cx, cz), cz, def.radius),
          from: new Vector3(at.x, ground + def.height, at.z),
          color: new Vector3(c.r, c.g, c.b).multiplyScalar(def.strength),
        });
        for (const [x, y, z] of lampHeads(kind)) {
          local.set(x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw));
          halo.push(at.x + local.x, ground + local.y, at.z + local.z);
          sizes.push(L.haloSize[kind]);
        }
      }
    }
    this.pick = new Int32Array(MAX);
    this.pickDist = new Float64Array(MAX);
    if (halo.length > 0) {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(halo), 3));
      g.setAttribute('size', new BufferAttribute(new Float32Array(sizes), 1));
      g.computeBoundingSphere();
      this.halos = new Points(g, haloMaterial);
      this.halos.matrixAutoUpdate = false;
      this.halos.visible = false;
      this.halos.renderOrder = 2;
    } else {
      this.halos = null;
    }
  }

  /** How strongly the lamps and headlamp shine: 0 (off, by day) to 1 (night). */
  setStrength(on: number): void {
    this.on = on;
    if (this.halos) this.halos.visible = on > 0;
    if (on <= 0) shared.poolCount.value = 0;
    const L = CONFIG.lights;
    (haloMaterial.uniforms.color!.value as Color).set(L.haloColor);
    haloMaterial.uniforms.strength!.value = L.haloStrength * on;
  }

  /**
   * The headlamp's pool ahead of the skier at (x, y, z) heading (fx, fz)
   * (unit, level), and the nearest lamps' pools to the camera at (camX,
   * camZ). `fogStart`, `fogEnd`, `pxPerM`: for fading and sizing halos.
   */
  update(x: number, y: number, z: number, fx: number, fz: number, camX: number, camZ: number, fogStart: number, fogEnd: number, pxPerM: number): void {
    if (this.on <= 0) return;
    const L = CONFIG.lights;
    const H = L.headlamp;
    const at = shared.poolAt.value;
    const from = shared.poolFrom.value;
    const color = shared.poolColor.value;
    // Slot 0: the headlamp, on the snow just ahead, lit from the head.
    const hx = x + fx * H.ahead;
    const hz = z + fz * H.ahead;
    at[0]!.set(hx, drawnHeightAt(this.hf, hx, hz), hz, H.radius);
    from[0]!.set(x, y + H.height, z);
    color[0]!.copy(headlampColor).multiplyScalar(H.strength * this.on);

    // The rest: the nearest lamps' pools (MAX - 1 of them), fading out with
    // distance. The list keeps one more, the nearest left out: every pool
    // has faded away by its distance, so the one that swaps out is dark.
    const n = Math.min(MAX, this.pools.length);
    let count = 0;
    for (let i = 0; i < this.pools.length; i++) {
      const p = this.pools[i]!.at;
      const d = Math.hypot(p.x - camX, p.z - camZ) - p.w;
      if (d > L.fadeEnd || (count === n && d >= this.pickDist[n - 1]!)) continue;
      // Into the list of the nearest n, kept sorted (the farthest drops off a full list).
      let j = count < n ? count++ : n - 1;
      while (j > 0 && this.pickDist[j - 1]! > d) {
        this.pick[j] = this.pick[j - 1]!;
        this.pickDist[j] = this.pickDist[j - 1]!;
        j--;
      }
      this.pick[j] = i;
      this.pickDist[j] = d;
    }
    const drawn = Math.min(count, MAX - 1);
    const cut = count > drawn ? this.pickDist[drawn]! : L.fadeEnd;
    const start = Math.min(L.fadeStart, cut * 0.6);
    for (let k = 0; k < drawn; k++) {
      const p = this.pools[this.pick[k]!]!;
      const fade = 1 - smoothstep(start, cut, this.pickDist[k]!);
      at[k + 1]!.copy(p.at);
      from[k + 1]!.copy(p.from);
      color[k + 1]!.copy(p.color).multiplyScalar(fade * this.on);
    }
    shared.poolCount.value = drawn + 1;

    const u = haloMaterial.uniforms;
    (u.fade!.value as number[])[0] = fogStart;
    (u.fade!.value as number[])[1] = fogEnd;
    u.scale!.value = pxPerM;
  }

  /** Turns the pools off (another map, or none) and frees the halos. */
  dispose(): void {
    shared.poolCount.value = 0;
    this.halos?.geometry.dispose();
  }
}

const headlampColor = new Vector3();
{
  const c = new Color(CONFIG.lights.headlamp.color);
  headlampColor.set(c.r, c.g, c.b);
}

/** Where a lamp's lit faces are (local, as drawProp draws them): a halo on each. */
function lampHeads(kind: LampKind): (readonly [number, number, number])[] {
  const S = DECOR_SIZE;
  if (kind === 'lightPole') return [[0, S.lightPoleHeight - 0.45, -1.4]];
  if (kind === 'streetLamp') return [[0, S.streetLampHeight - 0.15, 0]];
  const out: [number, number, number][] = [];
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 4; i++) out.push([-1.4 + i * 0.93, S.floodlightHeight + 0.95 + j * 0.85, -0.7]);
  }
  return out;
}
