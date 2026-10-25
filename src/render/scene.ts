import {
  type Camera,
  type Object3D,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { CONFIG } from '../config.ts';
import type { BuiltMap } from '../maps/build.ts';
import { Backdrop } from './backdrop.ts';
import type { ViewRange, WeatherLook } from './weather.ts';

export interface View {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** Sky light; its sky color follows the map's and the weather. */
  hemi: HemisphereLight;
  /** Sunlight (moonlight at night): its color and strength follow the weather. */
  sun: DirectionalLight;
  /** The sky and far ranges, drawn first each frame. */
  backdrop: Backdrop;
}

/** Sky and fog before any map is loaded (the map-select menu). */
const DEFAULT_SKY = '#9fc3e6';
const DEFAULT_FOG = '#dce8f3';

/**
 * Creates the renderer, scene, lights, fog and camera. Throws if WebGL is
 * unavailable. `antialias` (smooth edges) can only be chosen here, when the
 * WebGL context is made; the pixel ratio can change later (setPixelRatio).
 */
export function createView(container: HTMLElement, antialias: boolean, pixelRatio: number): View {
  const renderer = new WebGLRenderer({
    antialias,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(pixelRatio);
  // Checking each shader for errors the first time it's used waits on the
  // GPU (a stall the first time something new comes into view). Our shaders
  // are fixed, so production skips it; dev builds keep it to catch mistakes.
  renderer.debug.checkShaderErrors = import.meta.env.DEV;
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Each frame clears once, draws the backdrop, then the world over it (see renderFrame).
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  // The scene itself never moves. Left on, it would recompute its matrix
  // every frame and force every object under it to recompute theirs too;
  // off, only things that move (with matrixAutoUpdate on) update.
  scene.matrixAutoUpdate = false;
  const fogColor = new Color(DEFAULT_FOG);
  scene.fog = new Fog(fogColor.clone(), CONFIG.render.fogNear, CONFIG.render.fogFar);

  // Nothing past the fog is visible, so the far plane stops there too.
  const camera = new PerspectiveCamera(
    CONFIG.render.fov,
    window.innerWidth / window.innerHeight,
    CONFIG.render.near,
    CONFIG.render.fogFar,
  );

  const hemi = new HemisphereLight(DEFAULT_SKY, '#7d8796', CONFIG.light.hemiIntensity);
  scene.add(hemi);
  const sun = new DirectionalLight('#fff6e8', CONFIG.light.sunIntensity);
  const from = CONFIG.light.sunFrom;
  sun.position.set(from.x, from.y, from.z).normalize();
  scene.add(sun);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  return { renderer, scene, camera, hemi, sun, backdrop: new Backdrop() };
}

/**
 * Compiles every shader program `scene` can draw: alongside the game where
 * the GPU can (KHR_parallel_shader_compile; resolves once they're ready),
 * else at once.
 */
export function compileShaders(renderer: WebGLRenderer, scene: Object3D, camera: Camera, target?: Scene): Promise<unknown> {
  if (renderer.extensions.has('KHR_parallel_shader_compile')) return renderer.compileAsync(scene, camera, target);
  renderer.compile(scene, camera, target);
  return Promise.resolve();
}

/** Draws `ratio` pixels per CSS pixel from now on (the canvas is resized to match). */
export function setPixelRatio(view: View, ratio: number): void {
  if (view.renderer.getPixelRatio() !== ratio) view.renderer.setPixelRatio(ratio);
}

/** Draws a frame: the backdrop, then the world over it (through `camera`, the game's own unless given). */
export function renderFrame(view: View, camera: PerspectiveCamera = view.camera): void {
  view.backdrop.render(view.renderer, camera);
  view.renderer.clearDepth();
  view.renderer.render(view.scene, camera);
}

/**
 * Sets how far the camera sees: nothing past `far` (m) is drawn in the
 * world (the backdrop's coarse stand-in carries on past it, unless the
 * weather closes in), and the haze fades in from `fogStart` to complete at
 * `hazeEnd`.
 */
export function setViewRange(view: View, range: ViewRange): void {
  if (view.scene.fog instanceof Fog) {
    view.scene.fog.near = range.fogStart;
    view.scene.fog.far = range.hazeEnd;
  }
  view.backdrop.setHaze(range.fogStart, range.hazeEnd, range.far, range.clear);
  view.camera.far = range.far;
  view.camera.updateProjectionMatrix();
}

/** Builds a map's backdrop (its far ranges and the stand-in for its mountain); applyWeather colors it. */
export function applyMap(view: View, built: BuiltMap): void {
  view.backdrop.setMap(built.map, built.hf, built.decor.scatter);
}

/** Sets the sky, fog and lights to a weather's look, in the world and the backdrop. */
export function applyWeather(view: View, look: WeatherLook): void {
  view.scene.fog?.color.copy(look.fog);
  view.hemi.color.copy(look.hemiSky);
  view.hemi.groundColor.copy(look.hemiGround);
  view.hemi.intensity = look.hemiIntensity;
  view.sun.color.copy(look.sun);
  view.sun.intensity = look.sunIntensity;
  view.backdrop.setWeather(look);
}
