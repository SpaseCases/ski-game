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
}

/** Creates the renderer, scene, lights, fog and camera. Throws if WebGL is unavailable. */
export function createView(container: HTMLElement, map: MapDef): View {
  const renderer = new WebGLRenderer({
    antialias: CONFIG.render.antialias,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(CONFIG.render.pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const fogColor = new Color(map.colors.fog);
  scene.background = fogColor;
  scene.fog = new Fog(fogColor, CONFIG.render.fogNear, CONFIG.render.fogFar);

  // Nothing past the fog is visible, so the far plane stops there too.
  const camera = new PerspectiveCamera(
    CONFIG.render.fov,
    window.innerWidth / window.innerHeight,
    CONFIG.render.near,
    CONFIG.render.fogFar,
  );

  scene.add(new HemisphereLight(map.colors.sky, '#7d8796', CONFIG.light.hemiIntensity));
  const sun = new DirectionalLight('#fff6e8', CONFIG.light.sunIntensity);
  const from = CONFIG.light.sunFrom;
  sun.position.set(from.x, from.y, from.z).normalize();
  scene.add(sun);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  return { renderer, scene, camera };
}
