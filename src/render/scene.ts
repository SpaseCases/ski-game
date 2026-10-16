import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { CONFIG } from '../config.ts';
import type { MapDef } from '../maps/types.ts';

export interface View {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  /** Sky light; its sky color follows the map's. */
  hemi: HemisphereLight;
}

/** Sky and fog before any map is loaded (the map-select menu). */
const DEFAULT_SKY = '#9fc3e6';
const DEFAULT_FOG = '#dce8f3';

/** Creates the renderer, scene, lights, fog and camera. Throws if WebGL is unavailable. */
export function createView(container: HTMLElement): View {
  const renderer = new WebGLRenderer({
    antialias: CONFIG.render.antialias,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(CONFIG.render.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  // The scene itself never moves. Left on, it would recompute its matrix
  // every frame and force every object under it to recompute theirs too;
  // off, only things that move (with matrixAutoUpdate on) update.
  scene.matrixAutoUpdate = false;
  const fogColor = new Color(DEFAULT_FOG);
  scene.background = fogColor;
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

  return { renderer, scene, camera, hemi };
}

/** Sets the sky, fog and sky light to a map's colors. */
export function applyMapColors(view: View, map: MapDef): void {
  const fog = new Color(map.colors.fog);
  view.scene.background = fog;
  view.scene.fog?.color.copy(fog);
  view.hemi.color.set(map.colors.sky);
}
