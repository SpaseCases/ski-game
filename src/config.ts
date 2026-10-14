// Every tunable number lives here. Adjust values before rewriting logic.

export const CONFIG = {
  sim: {
    /** Fixed simulation rate (steps per second). */
    stepHz: 120,
    /** Longest frame (seconds) fed to the accumulator; stops a spiral after a stall or tab switch. */
    maxFrameTime: 0.25,
  },

  render: {
    /** Low preset: pixel ratio 1, no antialiasing. Quality presets come in a later milestone. */
    pixelRatio: 1,
    antialias: false,
    fov: 60,
    near: 0.1,
    /** Fog start and end distance in meters. The camera far plane follows fogFar. */
    fogNear: 70,
    fogFar: 240,
  },

  light: {
    hemiIntensity: 1.9,
    sunIntensity: 2.6,
    /** Direction the sunlight comes from (normalized at startup). Downhill and to the left. */
    sunFrom: { x: -0.5, y: 1, z: -0.35 },
  },

  camera: {
    /** Milestone 0 attract camera: slow orbit around the first feature. */
    orbitRadius: 24,
    orbitHeight: 9,
    /** Radians per second. */
    orbitSpeed: 0.12,
  },

  debug: {
    /** Seconds between frame-rate readout updates. */
    fpsInterval: 0.5,
  },
} as const;
