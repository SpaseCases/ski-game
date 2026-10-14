// Every tunable number lives here. Adjust values before rewriting logic.
// The object is mutable on purpose: the dev tuning panel edits it live.

export const CONFIG = {
  sim: {
    /** Fixed simulation rate (steps per second). */
    stepHz: 120,
    /** Longest frame (seconds) fed to the accumulator; stops a spiral after a stall or tab switch. */
    maxFrameTime: 0.25,
  },

  skier: {
    /** m/s². A little above real gravity so airs feel snappy. */
    gravity: 11,
    /** Kinetic friction coefficient along the skis. */
    skiFriction: 0.05,
    /** Quadratic air drag (per meter) standing up and fully crouched. */
    dragStand: 0.0055,
    dragCrouch: 0.003,
    /** Quadratic air drag (per meter) in the air. */
    dragAir: 0.004,

    /**
     * Sideways acceleration the edges can turn into a carve, as a multiple of
     * the snow's push back (normal load). Also caps how fast the skis turn at
     * speed, so a held turn carves instead of skidding out.
     */
    grip: 2.2,
    /** Fraction of the sideways speed turned into a carve that is lost (carving costs a little speed). */
    carveFriction: 0.08,
    /** Slip angle (radians) between skis and travel where carving has faded out and the skis just skid. Full grip below half of it. */
    carveSlipMax: 0.45,
    /** Friction coefficient of skis scraping sideways (skids, hockey stops). */
    skidFriction: 0.75,
    /** How much sideways pull from the slope the edges hold before slipping, as a multiple of normal load. */
    edgeHold: 0.9,

    /** Ski turn rate (rad/s) when stopped and at turnSpeedRef or faster. */
    turnRateSlow: 2.8,
    turnRateFast: 1.5,
    /** Speed (m/s) where the turn rate reaches turnRateFast. */
    turnSpeedRef: 20,
    /** How quickly the turn rate reaches its target (rad/s²). */
    turnResponse: 14,

    /** Extra deceleration (m/s²) at full brake. */
    brakeDecel: 7,
    /** Seconds to reach full brake. */
    brakeRampTime: 0.15,

    /** Speed (m/s) one pole push adds from a standstill; it shrinks to zero at poleMaxSpeed. */
    polePushSpeed: 1.8,
    poleMaxSpeed: 7,
    /** Seconds between pushes while Shift is held. */
    polePushInterval: 0.55,
    /** Seconds the push animation lasts. */
    polePushDuration: 0.5,

    /** Seconds to reach full crouch, and to stand back up. */
    crouchTime: 0.22,
    standTime: 0.1,
    /** Pop speed (m/s, along the snow normal) from no crouch and from full crouch. */
    popMin: 3,
    popMax: 5.2,
    /** Seconds after leaving the snow that a pop still works (helps time it at a lip). */
    popCoyoteTime: 0.12,

    /** Snow within this distance (m) under the skis still counts as riding, not flying. */
    groundTolerance: 0.04,
    /** Biggest lean into a turn (radians) and how fast lean follows (per second). */
    leanMax: 0.85,
    leanResponse: 8,
  },

  camera: {
    /** Distance behind and height above the skier, slow and at speedForFar. */
    distNear: 4.4,
    distFar: 6.4,
    heightNear: 2.1,
    heightFar: 2.6,
    /** m/s where the camera reaches its far distance. */
    speedForFar: 25,
    /** Aim point: height above the feet and distance ahead along travel. */
    lookHeight: 1.1,
    lookAhead: 2.5,
    /** Below travelMinSpeed the camera faces where the skis point; above travelFullSpeed it follows travel. */
    travelMinSpeed: 0.8,
    travelFullSpeed: 3,
    /** How fast (per second) the camera swings to its target heading. */
    yawSmoothing: 4.5,
    /** How fast (per second) the camera follows the skier's height on the snow and in the air. */
    heightSmoothingGround: 10,
    heightSmoothingAir: 3,
    /** Minimum gap (m) between camera and snow. */
    clearance: 0.7,
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
    /** Radians the skier swings sideways for a hockey stop at full brake. */
    brakeTwist: 1.2,
    /** How fast (per second) the skier tilts to match the snow or straightens in the air. */
    tiltSmoothing: 10,
  },

  light: {
    hemiIntensity: 1.9,
    sunIntensity: 2.6,
    /**
     * Direction the sunlight comes from (normalized at startup): high, from
     * the left and a little behind, so the chase camera sees the skier lit.
     */
    sunFrom: { x: -0.4, y: 1.2, z: 0.3 },
  },

  debug: {
    /** Seconds between frame-rate readout updates. */
    fpsInterval: 0.5,
  },
};
