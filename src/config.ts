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
    /** m/s². Above real gravity so the slope pulls hard and airs feel snappy. */
    gravity: 12,
    /** Kinetic friction coefficient along the skis. */
    skiFriction: 0.055,
    /** Quadratic air drag (per meter) standing up and fully crouched. */
    dragStand: 0.0075,
    dragCrouch: 0.002,
    /** Quadratic air drag (per meter) in the air. */
    dragAir: 0.004,

    /**
     * Sideways acceleration the edges can turn into a carve, as a multiple of
     * the snow's push back (normal load). Also caps how fast the skis turn at
     * speed, so a held turn carves instead of skidding out.
     */
    grip: 2.0,
    /** Fraction of the sideways speed turned into a carve that is lost (carving costs a little speed). */
    carveFriction: 0.08,
    /** Slip angle (radians) between skis and travel where carving has faded out and the skis just skid. Full grip below half of it. */
    carveSlipMax: 0.45,
    /** Friction coefficient of skis scraping sideways (skids, hockey stops). */
    skidFriction: 0.75,
    /** How much sideways pull from the slope the edges hold before slipping, as a multiple of normal load. */
    edgeHold: 0.9,

    /** Ski turn rate (rad/s) when stopped and at turnSpeedRef or faster. */
    turnRateSlow: 2.3,
    turnRateFast: 1.25,
    /** Speed (m/s) where the turn rate reaches turnRateFast. */
    turnSpeedRef: 20,
    /** How quickly the turn rate reaches its target (rad/s²). */
    turnResponse: 10,

    /** Extra deceleration (m/s²) at full brake. */
    brakeDecel: 11,
    /** Seconds to reach full brake. */
    brakeRampTime: 0.12,

    /** Speed (m/s) one pole push adds from a standstill; it shrinks to zero at poleMaxSpeed. */
    polePushSpeed: 3.1,
    poleMaxSpeed: 8.5,
    /** Seconds from the start of a push until the poles bite, then how long the push force lasts. */
    polePlantTime: 0.1,
    polePushTime: 0.5,
    /** Seconds per push cycle while Shift is held (also the length of the push animation). */
    polePushInterval: 0.73,

    /** Seconds to reach full crouch, and to stand back up. */
    crouchTime: 0.22,
    standTime: 0.1,
    /** Pop speed (m/s, along the snow normal) from no crouch and from full crouch. */
    popMin: 3.2,
    popMax: 5.5,
    /** Seconds after leaving the snow that a pop still works (helps time it at a lip). */
    popCoyoteTime: 0.12,

    /** Snow within this distance (m) under the skis still counts as riding, not flying. */
    groundTolerance: 0.04,
    /** Biggest lean into a turn (radians) and how fast lean follows (per second). */
    leanMax: 0.85,
    leanResponse: 8,
  },

  air: {
    /**
     * Height (m) of the body's center of mass above the feet. In the air the
     * skier rotates around it, so flips turn around the belly, not the boots.
     */
    comHeight: 0.85,
    /** Height (m) of the head above the feet; the head touching snow is a bail. */
    headHeight: 1.65,
    /** Rotation speeds (rad/s) while a key is held: spin (←/→), flip (↑/↓), Lincoln loop (Q/E). */
    spinRate: 6.5,
    flipRate: 5.5,
    lincolnRate: 5,
    /** How fast held keys build rotation, and how fast it dies after release (rad/s²). */
    rotateAccel: 24,
    rotateStop: 15,
    /** Share of the carving turn rate at takeoff that becomes spin. Untouched, it keeps spinning. */
    spinCarry: 1,
    /** Extra spin (rad/s) when a spin key is already held as the skis leave the snow. */
    spinPreload: 2.5,
    /**
     * How fast (per second) the skis' pitch follows the flight path, like an
     * arrow. Off a jump this brings the skis in line with a landing built for
     * that trajectory; flips add on top. 0 keeps the takeoff pitch all flight.
     */
    pathAlign: 2.2,
    /** Speeds (m/s) along the skis where path following starts and is full (none for a pop in place). */
    pathSpeedMin: 2,
    pathSpeedFull: 8,
  },

  landing: {
    /** Biggest nose-up or nose-down angle (radians) between the skis and the snow that still lands. */
    pitchMax: 0.6,
    /** Biggest roll onto an edge (radians) that still lands; past it the edge catches. */
    rollMax: 0.9,
    /** Biggest angle (radians) between the skis and the direction of travel (or its reverse) that still lands. */
    sideMax: 1,
    /** Below this speed (m/s) along the snow, landing sideways is fine. */
    sideSpeed: 6,
    /** Airs shorter than this (seconds) skip the edge and sideways checks, so a skid over a small bump never catches. */
    edgeCheckAir: 0.3,
    /** Speed (m/s) into the snow that is too hard to absorb. */
    impactMax: 15,
    /** Speed into the snow (m/s) that gives a full-depth absorb crouch, and how long it lasts (s). */
    squashImpact: 9,
    squashTime: 0.35,
  },

  rails: {
    /** Radius (m) of a round rail. */
    radius: 0.045,
    /**
     * Light magnet: skis coming down within this distance (m) of a rail's
     * line, or of a box's edge, lock onto it.
     */
    snapDistance: 0.35,
    /** How far (m) below the top the skis can already be in one step and still lock on. */
    catchDepth: 0.3,
    /** Biggest angle (radians) between the skis and straight or sideways that still locks on. Past it they slip off. */
    angleMax: 0.6,
    /** Biggest tilt (radians) of the body away from upright on the rail that still locks on. */
    tiltMax: 0.75,
    /** Sliding friction coefficient on a metal rail and on a box. */
    railFriction: 0.05,
    boxFriction: 0.09,
    /** Top speed (rad/s) ←/→ turns the skis on a rail, and how fast that speed builds and stops (rad/s²). */
    turnRate: 4,
    turnAccel: 30,
    /** Share of that turning speed that carries into a spin when leaving the rail mid-turn. */
    spinCarry: 0.5,
    /** Sideways speed (m/s) given when slipping off, so the skier falls clear of the rail. */
    slipSpeed: 1.2,
    /** Radius (m) of the body when bumping into rails and boxes. */
    bodyRadius: 0.25,
    /** Skis this far (m) below the top of a rail or box are hitting its side, not riding over it. */
    stepTolerance: 0.12,
    /** Speed (m/s) into the side of a rail or box that crashes; slower bumps just stop. */
    crashSpeed: 5,
  },

  bail: {
    /** Friction coefficient of a tumbling body sliding on snow. */
    friction: 0.7,
    /** Share of speed along the snow lost in the crash impact. */
    impactLoss: 0.3,
    /** Rolling radius (m): tumble rate is speed divided by this, times tumbleScale. */
    rollRadius: 0.5,
    tumbleScale: 0.6,
    /** Height (m) of the tumbling body's center above the snow. */
    centerHeight: 0.42,
    /** Seconds after a crash before the screen fades and the skier respawns; then the fade time. */
    respawnDelay: 1.5,
    fadeTime: 0.3,
  },

  camera: {
    /** Distance behind and height above the skier, slow and at speedForFar. */
    distNear: 4.4,
    distFar: 6.4,
    heightNear: 2.35,
    heightFar: 4.85,
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
    /** Mouse-drag orbit: radians turned per pixel dragged. */
    orbitSensitivity: 0.006,
    /** Extra tilt the drag can add (radians, below and above the normal view). */
    orbitPitchMin: -0.5,
    orbitPitchMax: 0.85,
    /**
     * After letting go, once the skier is faster than orbitHoldSpeed (m/s),
     * the camera waits orbitReturnDelay seconds and then swings back behind
     * at orbitReturnRate per second. Slower than that, the view stays put.
     */
    orbitHoldSpeed: 2,
    orbitReturnDelay: 1,
    orbitReturnRate: 2,
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
    /** Radians the skis swing sideways for a hockey stop at full brake. */
    brakeTwist: 1.2,
    /** Share of that swing the upper body turns back to keep facing down the hill. */
    brakeCounter: 0.4,
    /** Lean (radians) away from the skid, and how far toward a crouch the skier sinks, at full brake. */
    brakeLean: 0.3,
    brakeSink: 0.35,
    /** Speeds (m/s) where holding ↑ shifts from the pop crouch into a speed tuck. */
    tuckSpeedMin: 7,
    tuckSpeedFull: 12,
    /** How fast (per second) the skier tilts to match the snow, and eases out of a jump in orientation (takeoff, landing, crash). */
    tiltSmoothing: 10,
    /**
     * Turning comes from the knees and hips, not a stiff lean from the boots.
     * leanBodyShare is the part of the sim's turn lean that tilts the whole
     * body; the rest drives the knees and hips into the turn while the skis
     * roll onto their edges by the full lean.
     */
    leanBodyShare: 0.5,
    /** Share of that knee-and-hip angulation kept in a full crouch or tuck; the rest tilts the whole body. */
    crouchAngulation: 0.25,
    /** Hips move into the turn (m per radian of knee-and-hip lean); knees point into it this hard. */
    hipShift: 0.3,
    kneeDrive: 1.1,
    /** Hips sink in a turn (m per radian of lean). */
    turnSink: 0.1,
    /** Upper body turns to face down the hill in a turn (radians per radian of lean). */
    turnCounter: 0.25,
    /** Seconds to reach or let go of a grab. */
    grabBlendTime: 0.12,
    /** How far toward a crouch the body sits in the air, and the extra tuck at full rotation speed. */
    airCrouch: 0.3,
    spinTuck: 0.4,
    /** Seconds to blend into the crash tumble. */
    bailBlendTime: 0.2,
    /** How far toward a crouch the skier sits while sliding a rail or box, and seconds to blend in and out. */
    railCrouch: 0.35,
    railBlendTime: 0.1,
    /** Thickness (m) of the posts under a rail. */
    railPostWidth: 0.07,
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
