import { MeshLambertMaterial } from 'three';

// Cloth that moves in the wind: banners, bunting and flags. Their meshes
// carry a `sway` weight per vertex (0 where the cloth is tied on, up to 1 at
// a free edge, see MeshKit.panel), and this material pushes those vertices
// about with a few sine waves of time and place, on the GPU. Flat shading
// works its facets' light out after the push, so the folds catch the sun.

/** Seconds of wind, shared by every cloth; the world view moves it on each frame. */
export const clothTime = { value: 0 };

export const clothMaterial = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
clothMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uWindTime = clothTime;
  shader.vertexShader =
    'attribute float sway;\nuniform float uWindTime;\n' +
    shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float windPhase = uWindTime * 2.2 + position.x * 0.37 + position.z * 0.29 + position.y * 0.5;
      transformed.x += sway * (sin(windPhase) * 0.16 + sin(windPhase * 2.9 + 1.3) * 0.05);
      transformed.z += sway * cos(windPhase * 1.2) * 0.13;
      transformed.y += sway * sin(windPhase * 1.7) * 0.03;`,
    );
};
