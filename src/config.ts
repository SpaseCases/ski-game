// Every tunable number lives here. Adjust values before rewriting logic.
// The object is mutable on purpose: the tuning panel edits it live. The sim
// doesn't read it directly: it reads sim/tuning.ts's TUNING, these numbers
// times the ski's and the cheats' multipliers (the `cheats` block below).

export const CONFIG = {
  sim: {
    /** Fixed simulation rate (steps per second). */
    stepHz: 120,
    /** Longest frame (seconds) fed to the accumulator; stops a spiral after a stall or tab switch. */
    maxFrameTime: 0.25,
    /** Game speed: the share of real time fed to the simulation (and everything else that moves by time). */
    timeScale: 1,
  },

  skier: {
    /** m/s². Above real gravity so the slope pulls hard and airs feel snappy. */
    gravity: 12,
    /** Kinetic friction coefficient along the skis. */
    skiFriction: 0.035,
    /** Quadratic air drag (per meter) standing up and fully crouched. */
    dragStand: 0.0055,
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
    brakeDecel: 9.5,
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
    /**
     * Snow curving up under the skis (a halfpipe transition, the bottom of a
     * dip) pushes on them harder than gravity alone. This share of that extra
     * push (m/s², capped at curveLoadMax) adds to the load the edges grip
     * with and friction works against; curveSmoothing (per second) evens it out.
     */
    curveLoad: 1,
    curveLoadMax: 60,
    curveSmoothing: 15,
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
    /**
     * Snow steeper than this (degrees) is a wall: riding up it and off the
     * top launches straight up, rotating in the wall's plane, so the skier
     * comes back down into the halfpipe (or a gully: the snow rounds off at
     * a gully's lip, so this sits a little under its steepest walls). The
     * skis' heading then follows the path along the wall instead of their pitch.
     */
    wallAngle: 44,
    /** How far (m) back inside the lip a wall air comes down. */
    wallDrift: 0.6,
    /** Share of a pop that a wall (or a halfpipe's transition) turns into speed straight up. */
    wallPop: 0.4,
    /** Fastest (m/s) a wall air launches upward; about 3.4 m above the lip. Faster is lost, which keeps pipe speed in check. */
    wallLaunchMax: 9,
  },

  landing: {
    /** Biggest nose-up or nose-down angle (radians) between the skis and the snow that still lands. */
    pitchMax: 0.6,
    /** Biggest roll onto an edge (radians) that still lands; past it the edge catches. */
    rollMax: 1.15,
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
    /**
     * Rough landings (casing a deck, coming up short on a knuckle): past
     * roughImpact m/s into the snow, each extra m/s loses roughLoss of the
     * speed along the snow, up to roughLossMax.
     */
    roughImpact: 7,
    roughLoss: 0.04,
    roughLossMax: 0.4,
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
    /** Speed (m/s) into the side of a rail or box (or a tree, a fence...) that crashes; slower bumps just stop. */
    crashSpeed: 5,
    /**
     * Riding onto a rail or box that starts at the snow: travel has to be at
     * least this lined up with it (cosine of the angle) to lock on.
     */
    mountAlign: 0.75,
    /** Snow this far (m) above a rail's top takes the skis off it; a top this far below the skis can't be ridden onto. */
    sinkDepth: 0.03,
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
    centerHeight: 0.5,
    /** Seconds after a crash before the screen fades and the skier respawns; then the fade time. */
    respawnDelay: 1.5,
    fadeTime: 0.3,
  },

  checkpoints: {
    /** Seconds R must be held to go back to the top. */
    holdToTop: 1,
    /** Seconds R is held before the "back to top" progress bar appears (a tap never shows it). */
    holdHintDelay: 0.2,
    /** Seconds a checkpoint toast stays on screen. */
    toastTime: 1.6,
    /** Flag pole height (m), and the pennant's length and drop. */
    poleHeight: 3.2,
    pennantLength: 1.5,
    pennantDrop: 1,
    /** Height (m) of the finish banner's bottom edge, and its depth. */
    finishHeight: 4.2,
    finishBanner: 1.2,
  },

  slalom: {
    /** Pole height (m) above the snow. */
    poleHeight: 1.8,
    /**
     * A pole closer than this (m) to the skier's knees, hips or chest (leaning
     * into the turn as drawn) is knocked aside: the body's half width with arms.
     */
    clipReach: 0.45,
    /**
     * A pole that far off the line the body travels along that it's within
     * the last grazeWidth (m) of clipReach is only brushed: a small flick, no
     * speed lost. Squarer hits cost more, up to clipSlow and clipPush.
     */
    grazeWidth: 0.2,
    /** Bend speed (rad/s) a square knock gives per m/s of the skier's speed (a quarter of it for a brush). */
    kick: 0.6,
    /** A square knock costs the skier this much speed (m/s) and pushes them this fast (m/s) away from the pole. */
    clipSlow: 1,
    clipPush: 0.8,
    /** How a bent pole springs back (per second², per second), and the most it bends (radians). */
    stiffness: 60,
    damping: 5,
    maxBend: 1.3,
  },

  /**
   * Giant slalom gates: each side is a panel strung between two poles (as
   * tall as a slalom pole). Both poles are hinged at the snow, so the panel
   * tips over forward or back as one, heavier than a single pole: it springs
   * back slower, and running into it costs more speed.
   */
  giantSlalom: {
    /** Panel width between its poles, and the heights (m above the snow) of its bottom and top edges. */
    panelWidth: 0.75,
    panelBottom: 0.95,
    panelTop: 1.5,
    /** A panel closer than this (m) to the skier's knees, hips or chest is knocked over. */
    clipReach: 0.42,
    /** Catching an end pole this close (m) to the edge of the reach only brushes it (see slalom.grazeWidth). */
    grazeWidth: 0.17,
    /** Tip speed (rad/s) a square knock gives per m/s of the skier's speed. */
    kick: 0.45,
    /** A square knock costs the skier this much speed (m/s) and pushes them this fast (m/s) off the panel's end. */
    clipSlow: 1.6,
    clipPush: 0.6,
    stiffness: 40,
    damping: 6,
    maxBend: 1.15,
  },

  quality: {
    /**
     * Share of scenery decoration (trees and rocks off the course) drawn by
     * each preset. Solid decoration is always drawn. Auto draws Medium's.
     */
    decorDensity: { auto: 0.7, low: 0.35, medium: 0.7, high: 1 },
    /**
     * How far (m) each preset sees (the fog's end and the camera's far
     * plane), and where its fog starts. Ground past about 330 m is drawn
     * coarser (see render/terrainMesh.ts). Auto sees as far as Medium until
     * milestone 8's frame-rate scaling can pull it in.
     */
    viewDistance: { auto: 450, low: 240, medium: 450, high: 800 },
    fogStart: { auto: 160, low: 70, medium: 160, high: 320 },
    /**
     * Where the haze is complete (m). Past the far plane the mountain carries
     * on as a coarse lit stand-in, fading by the same haze (see
     * render/backdrop.ts); Low's haze ends at its far plane, a wall of fog.
     */
    hazeEnd: { auto: 3200, low: 240, medium: 3200, high: 6000 },
    /** Trees farther than this (m) are drawn as simple stand-ins, when the view reaches that far. */
    treeDetail: 220,
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
    /**
     * On a slope the snow behind the skier rises toward the camera. This
     * share of that rise (m, up to slopeLiftMax) lifts the camera, so in the
     * steeps it still looks down at the skier and the slope below instead of
     * up at them. Smoothed at heightSmoothingGround.
     */
    slopeLift: 0.9,
    slopeLiftMax: 7,
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
    /** Fog start and end distance in meters before a quality preset applies its own (see quality.viewDistance). The camera far plane follows fogFar. */
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

  /**
   * Cheats (the Cheats screen): each one multiplies these numbers in their
   * blocks above while it's on. They combine freely, and No crashes (no
   * numbers) is a switch the sim reads. See sim/tuning.ts.
   */
  cheats: {
    /** Long floaty airs. */
    lowGravity: { skier: { gravity: 0.4 } },
    /**
     * A much higher top speed: less ski friction and air drag (riding and
     * flying), and a much stronger pole push: each push adds more speed, it
     * keeps helping up to a higher speed, and the pushes come quicker (plant,
     * stroke and the whole cycle all shorter). Gravity stays, so it still
     * works with Low gravity.
     */
    superFast: {
      skier: {
        skiFriction: 0.3,
        dragStand: 0.4,
        dragCrouch: 0.4,
        dragAir: 0.4,
        polePushSpeed: 2,
        poleMaxSpeed: 2.5,
        polePlantTime: 0.6,
        polePushTime: 0.6,
        polePushInterval: 0.6,
      },
    },
    /** Pops launch far higher. */
    moonJump: { skier: { popMin: 2.5, popMax: 2.5 } },
    /** The whole game runs slower, so tricks are easier to time. */
    slowMotion: { sim: { timeScale: 0.5 } },
    /** Spins, flips and Lincoln loops rotate faster, and reach their speed as quickly. */
    turboSpins: { air: { spinRate: 2, flipRate: 2, lincolnRate: 2, rotateAccel: 2 } },
  },

  /** The Locker's live preview of the skier. */
  locker: {
    /** How fast it turns (rad/s). */
    turnRate: 0.45,
    /** Half the height and half the width (m) round the skier the camera keeps in view. */
    halfHeight: 1.2,
    halfWidth: 0.95,
    /** Camera height above the aim (m). */
    rise: 0.55,
    /** Where the title's stage camera stands (rad from straight in front; < 0 is the skier's right). */
    stageAngle: -0.35,
  },

  debug: {
    /** Seconds between frame-rate readout updates. */
    fpsInterval: 0.5,
  },
};
