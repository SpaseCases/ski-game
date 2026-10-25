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
    /**
     * Riding switch (backwards), grip and edgeHold are multiplied by these:
     * 1 here, so switch rides like forwards; a ski can lower them (see
     * `skis`). They take full effect once the skis slide backwards at
     * switchSpeed m/s, fading in from 0, so a hockey stop isn't switch.
     */
    switchGrip: 1,
    switchEdgeHold: 1,
    switchSpeed: 3,

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

    /**
     * Butters: on the snow, holding a nose grab key presses onto the ski tips
     * and a tail grab key onto the tails, easing in over butterBlendTime (s).
     * Pressed, ←/→ pivot the skis at butterSpinRate (rad/s, reached at
     * butterSpinResponse rad/s²) instead of carving. The edges grip only
     * butterGrip of usual, so the skier keeps sliding the way they were
     * going, and sliding sideways scrapes off only butterSkid of the usual
     * speed. Popping out of a press (an ollie off the tails, a nollie off the
     * tips) is butterPop times as strong; the pivot carries into the air like
     * a carving turn's (air.spinCarry).
     */
    butterBlendTime: 0.12,
    butterSpinRate: 4.5,
    butterSpinResponse: 25,
    butterGrip: 0.08,
    butterSkid: 0.25,
    butterPop: 1.1,
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
    /**
     * A wall air that comes out over snow that isn't a wall (off the end of a
     * quarterpipe or wallride, or out over a deck) tips back toward that
     * snow at this rate (per second), so the skier comes down upright on it
     * instead of still leaning out at the wall's angle.
     */
    wallLevel: 3,
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
    /** Extra deceleration (m/s²) at full brake on a rail or box: ↓ drags the skis against it (it ramps in over skier.brakeRampTime). */
    brakeDecel: 6,
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

  /**
   * Scoring (GAME_DESIGN.md, Scoring): tricks, grabs, rails and big airs
   * build a combo while its timer keeps getting topped up; when the timer
   * runs out on the snow the combo is banked (its points times its
   * multiplier), and a crash loses it. The timer runs on game time, so slow
   * motion slows it too. Angles here are degrees.
   */
  score: {
    /** Seconds on the combo timer after a new trick. */
    comboTime: 4,
    /** In the air the timer drains at this share of real speed, and can't run out there: it holds at airFloor s (or what was left, if less). On a rail it holds. */
    airDrain: 0.5,
    airFloor: 0.75,
    /**
     * Flow: carving hard at speed slows the drain by up to flowSlow (0..1)
     * and adds flowPoints per second to a live combo. Full flow from
     * flowLeanFull rad of edge angle and flowSpeedFull m/s; none below the
     * Min values. It never starts or refills a combo.
     */
    flowSlow: 0.6,
    flowPoints: 25,
    flowLeanMin: 0.25,
    flowLeanFull: 0.6,
    flowSpeedMin: 8,
    flowSpeedFull: 16,
    /** A small air with no trick adds this many points per second of air to a live combo (flow, no refill). */
    smallAirPoints: 40,
    /** An air this long (s) with no trick still counts as a jump ("Air"): it scores and refills the timer but adds no multiplier. Longer than a full pop on the flat (~0.9 s). */
    jumpAir: 1.2,
    /** Points per second of air on a trick or a jump. */
    airPoints: 50,
    /** Points per 180° of spin; a cork (spinning with corkMin° or more off-axis) adds corkBonus of that. */
    spinPoints: 150,
    corkBonus: 0.5,
    corkMin: 50,
    /** Points per full flip and per full Lincoln loop. */
    flipPoints: 400,
    lincolnPoints: 400,
    /** How far short (degrees) of a 180 a spin, and of 360 a flip or Lincoln loop, still counts. Onto or off a rail spins count in 90s, half as short. */
    spinShort: 45,
    flipShort: 90,
    /** Spinning onto or off a rail counts from this many degrees (the 90 to land sideways is the slide itself). */
    railSpinMin: 180,
    /** A grab held at least grabMin s scores grabPoints, plus grabHoldPoints per second held, up to grabHoldMax s. */
    grabMin: 0.2,
    grabPoints: 100,
    grabHoldPoints: 100,
    grabHoldMax: 2,
    /**
     * Rails and boxes: points per meter slid (from railMin m, up to railMax m:
     * past that a slide keeps the combo alive but scores no more, so the
     * Park's top-to-bottom rail isn't worth more than every trick), times
     * railSideways sliding sideways and railSwitch riding them switch.
     */
    railMin: 1,
    railMax: 40,
    railPoints: 30,
    railSideways: 1.5,
    railSwitch: 1.25,
    /**
     * Butters (pressing the tips or tails on the snow, butterAmount past
     * butterMin): a pivot scores butterSpinPoints per 180° turned (counted
     * like a spin, spinShort short), plus butterPressPoints per second
     * pressed up to butterPressMax s. A press with no pivot counts from
     * butterPressMin s. Popping out of a press is an ollie (tails) or a
     * nollie (tips): the air's trick is named after it and adds ollieBonus.
     */
    butterMin: 0.5,
    butterSpinPoints: 75,
    butterPressPoints: 50,
    butterPressMax: 3,
    butterPressMin: 0.6,
    ollieBonus: 0.25,
    /** Landings: clean adds cleanBonus of the trick's points; sketchy scores sketchyScale of them and adds no multiplier. Taking off or landing switch adds switchBonus each. */
    cleanBonus: 0.25,
    sketchyScale: 0.5,
    switchBonus: 0.25,
    /** Sketchy: past these shares of the landing limits (CONFIG.landing: pitchMax, rollMax, sideMax, impactMax). */
    sketchyPitch: 0.75,
    sketchyRoll: 0.5,
    sketchySide: 0.5,
    sketchyImpact: 0.9,
    /**
     * Each repeat of a trick in one combo scores and adds to the multiplier
     * repeatScale times what the time before did (a new trick adds 1 to the
     * multiplier; a gain under multGainMin adds nothing), and tops the timer
     * up to repeatRefill times the time before (so spamming one trick on the
     * flat can't keep a combo alive). The multiplier stops at multMax.
     */
    repeatScale: 0.5,
    repeatRefill: 0.75,
    multGainMin: 0.25,
    multMax: 10,
    /** HUD (real time): seconds a trick line stays up, and a banked or lost combo; the timer bar warns with this many seconds (game time) left. */
    hudTrickTime: 2.6,
    hudBankTime: 2.6,
    hudTimerLow: 1,
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

  /**
   * Snow effects (render/snowFx.ts): spray, ski tracks, landing puffs, crash
   * bursts, rail sparks, powder clouds and snow blowing off ridges. Rates are
   * particles per second at full strength; sizes are radii in meters.
   */
  snowFx: {
    /** Most particles alive at once, per preset; the oldest give way to new ones. Auto uses Medium's. */
    particles: { auto: 700, low: 320, medium: 700, high: 1200 },
    /** Share of every emission rate each preset spawns, so a small pool isn't simply overrun. */
    rate: { auto: 0.8, low: 0.5, medium: 0.8, high: 1 },
    /** Points kept per ski track, and seconds a track takes to fade, per preset. */
    trackPoints: { auto: 150, low: 64, medium: 150, high: 280 },
    trackLife: { auto: 14, low: 6, medium: 14, high: 28 },
    /** Ridge snow is blown only from emitters this close (m) to the camera. */
    ridgeRange: { auto: 150, low: 90, medium: 150, high: 210 },
    /** Meters between track points. */
    trackSpacing: 0.6,
    /** Width (m) and opacity of a ski's track, the same in powder and on groomed snow. */
    trackWidth: 0.12,
    trackOpacity: 0.32,
    /** Length (m) of a ski, for the smear it leaves skidding sideways; the smear is lighter and no wider than smearMax. */
    skiLength: 1.6,
    smearOpacity: 0.6,
    smearMax: 1.3,
    /** Carving: spray starts at edgeMin radians of lean and speedMin m/s, full at edgeFull and speedFull. */
    carve: { edgeMin: 0.3, edgeFull: 0.8, speedMin: 5, speedFull: 16, rate: 320 },
    /** Braking or hockey stopping: a sheet of spray off the skis' leading edges, full at speedFull m/s. */
    brake: { speedMin: 2, speedFull: 12, rate: 480 },
    /** Spray particles: life (s), start and end size, how hard gravity pulls them (share of 1 g), and air drag (per s). */
    spray: { life: 0.6, size0: 0.025, size1: 0.085, gravity: 0.6, drag: 2.2 },
    /**
     * Powder (off the runs on maps with `powder`): spray grows bigger, lasts
     * longer, floats, and comes thicker; just riding fast kicks up a trail.
     */
    powder: { size: 4, life: 2.2, gravity: 0.25, drag: 1.4, rate: 1.6, trailRate: 70, trailSpeed: 6 },
    /** A puff on landings harder than impactMin m/s into the snow, full at impactFull: up to `count` particles. */
    landing: { impactMin: 3, impactFull: 12, count: 70 },
    /** A burst on a crash, and a trail while the body tumbles along the snow (per m/s of speed). */
    crash: { count: 70, trailRate: 6 },
    /** Sparks off metal rails (not boxes or logs): full at speedFull m/s along the rail, and (1 + brake) times as many at full brake. */
    sparks: { speedMin: 1.5, speedFull: 10, rate: 150, life: 0.35, brake: 2 },
    /**
     * Snow blowing off ridges, wind lips and cornices (Freeride): an emitter
     * every `spacing` m along each, gusting; `rate` per emitter at the top
     * of a gust.
     */
    ridge: { spacing: 10, rate: 24, life: 2.4, size0: 0.08, size1: 0.36 },
    /** Which way the wind blows (XZ, normalized at use), and how fast (m/s) on a clear day. Wind lips blow toward their own lee. */
    wind: { x: 0.8, z: 0.6 },
    windSpeed: 5,
    /**
     * Falling snow (the weather's snowfall): flakes of its own, apart from
     * the particle pool, in a box round the camera (`box` m across, `height`
     * m tall, its middle `ahead` m in front) that they wrap round as the
     * camera moves. Flakes at full snowfall per preset; a flake's radius
     * (m), how fast it falls (m/s), and how far a gust sways it.
     */
    flakes: { auto: 900, low: 520, medium: 900, high: 1400 },
    flakeBox: 30,
    flakeHeight: 16,
    flakeAhead: 9,
    flakeSize: { min: 0.045, max: 0.075 },
    flakeFall: 1.6,
    flakeSway: 0.8,
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
   * Weather (picked on each map card and from pause; see render/weather.ts).
   * A map's own colors are its bluebird look: each weather mixes the map's
   * sky and fog toward its own `to` by `mix` (0 keeps the map's), unless the
   * map overrides them (MapDef.weather). Lights: the sun (the moon at night)
   * and the sky light's colors and strengths, `hemiSky` null meaning the
   * map's own sky color. `skyFull`: degrees over the horizon where the
   * sky reaches its full color (from the haze's at the horizon). `haze` scales each preset's fog start and haze end (Low's
   * fog never reaches past its far plane); `view` instead pulls every
   * preset's view in to `far` m, fogged from `fogStart`. `peaks` relights
   * the far ranges (multipliers on their sky light and sunlight). `fx`
   * drives the snow effects (render/snowFx.ts: snowfall is the share of the
   * flake budget falling). `glow` lights the jack-o'-lantern's face, `lamps`
   * switches on the light pools and lamp halos (see lights), `stars` the
   * moon and stars, and `fxTint` multiplies the color of blowing and
   * falling snow (drawn unlit) and the spray's own glow.
   */
  weather: {
    bluebird: {
      // A clear sky: deep blue down to a light blue haze at the horizon.
      sky: { to: '#1f6fd1', mix: 0.75 },
      skyFull: 9,
      fog: { to: '#b9d6f3', mix: 0.5 },
      sun: '#fff6e8',
      sunIntensity: 2.6,
      hemiSky: null as string | null,
      hemiGround: '#7d8796',
      hemiIntensity: 1.9,
      haze: { fogStart: 1, hazeEnd: 1 },
      view: null as { far: number; fogStart: number } | null,
      peaks: { light: '#ffffff', sun: '#ffffff' },
      fx: { snowfall: 0, ridgeSnow: 1, wind: 1, gust: 0.3 },
      fxTint: '#ffffff',
      glow: 0,
      lamps: 0,
      stars: 0,
    },
    overcast: {
      skyFull: 32,
      sky: { to: '#aab4c0', mix: 0.85 },
      fog: { to: '#c8ced6', mix: 0.85 },
      sun: '#eef0f3',
      sunIntensity: 0.9,
      hemiSky: '#d9dee5' as string | null,
      hemiGround: '#8e949d',
      hemiIntensity: 2.5,
      haze: { fogStart: 0.6, hazeEnd: 0.35 },
      view: null as { far: number; fogStart: number } | null,
      peaks: { light: '#c3c9d1', sun: '#3a3d42' },
      fx: { snowfall: 0, ridgeSnow: 1.4, wind: 1.4, gust: 0.4 },
      fxTint: '#e8ebef',
      glow: 0,
      lamps: 0,
      stars: 0,
    },
    blizzard: {
      skyFull: 32,
      sky: { to: '#adb4bd', mix: 1 },
      fog: { to: '#bfc5cc', mix: 1 },
      sun: '#eef1f5',
      sunIntensity: 0.9,
      hemiSky: '#d6dbe1' as string | null,
      hemiGround: '#7d848e',
      hemiIntensity: 2,
      haze: { fogStart: 1, hazeEnd: 1 },
      view: { far: 115, fogStart: 12 } as { far: number; fogStart: number } | null,
      peaks: { light: '#c3c9d1', sun: '#3a3d42' },
      fx: { snowfall: 1, ridgeSnow: 3, wind: 2.6, gust: 0.9 },
      fxTint: '#f2f4f7',
      glow: 0,
      lamps: 0,
      stars: 0,
    },
    night: {
      skyFull: 32,
      sky: { to: '#0a1430', mix: 1 },
      fog: { to: '#1a2848', mix: 1 },
      sun: '#9fb6ff',
      sunIntensity: 0.5,
      hemiSky: '#4d64a0' as string | null,
      hemiGround: '#0d121c',
      hemiIntensity: 0.65,
      haze: { fogStart: 0.8, hazeEnd: 0.5 },
      view: null as { far: number; fogStart: number } | null,
      peaks: { light: '#2a3657', sun: '#56699c' },
      fx: { snowfall: 0, ridgeSnow: 1, wind: 1, gust: 0.3 },
      fxTint: '#4a5878',
      glow: 1,
      lamps: 1,
      stars: 1,
    },
  },

  /**
   * Night lights (render/lightPools.ts), all faked: pools of light added to
   * the snow and features' shading (no real lights), and soft halos round
   * the lamps. Each pool: `ahead` m out from the lamp the way it faces, of
   * `radius` m, lit from `height` m up, its color times `strength`.
   */
  lights: {
    /** The skier's headlamp: a pool `ahead` m in front of them on the snow, lit from their head. */
    headlamp: { ahead: 7, radius: 10, height: 1.7, color: '#e9f0ff', strength: 1.4 },
    floodlight: { ahead: 22, radius: 38, height: 14, color: '#fff0d8', strength: 2.2 },
    lightPole: { ahead: 4, radius: 16, height: 8, color: '#ffe9c8', strength: 1.6 },
    streetLamp: { ahead: 0, radius: 9, height: 4.6, color: '#ffc883', strength: 1.5 },
    /** Pools drawn at once, the headlamp's included (each costs the GPU a little per vertex). */
    max: 10,
    /** Pools fade out between these distances (m) from the camera, so the nearest ones swap in unseen. */
    fadeStart: 260,
    fadeEnd: 340,
    /** Halo size (m across) round each floodlight head, light pole and street lamp, and their brightness. */
    haloSize: { floodlight: 2.4, lightPole: 2.2, streetLamp: 1.8 },
    haloStrength: 0.8,
    haloColor: '#ffe7c0',
    /** The moon: where it hangs (from the map's middle; normalized at use), its size (degrees across) and color, and how many stars. */
    moonAt: { x: -0.45, y: 0.3, z: -0.84 },
    moonSize: 3,
    moonColor: '#eef2ff',
    stars: 900,
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

  /**
   * Skis (the Locker): the ski in use multiplies these numbers in their
   * blocks above, before any cheat (see sim/tuning.ts). The park ski's are
   * all 1, so it rides exactly as the maps were tuned for. Every ski is the
   * same length to the physics; only the model's looks differ.
   */
  skis: {
    park: {},
    /** Bigger drops and forgiving landings; slower spins, flips and Lincoln loops (a 720 still fits the 720 jumps). */
    big: {
      landing: { impactMax: 1.3, pitchMax: 1.35 },
      air: { spinRate: 0.85, flipRate: 0.85, lincolnRate: 0.85 },
    },
    /**
     * Holds an edge at speed, keeps speed through turns, turns sharper when
     * fast, and a higher top speed (less friction and drag); stiff landings,
     * slower spins, and twitchy riding switch: less grip and edge hold going
     * backwards, so it skids out and slips down the hill more easily.
     */
    carving: {
      skier: {
        grip: 1.3,
        carveFriction: 0.5,
        turnRateFast: 1.3,
        skiFriction: 0.8,
        dragStand: 0.9,
        dragCrouch: 0.9,
        dragAir: 0.9,
        switchGrip: 0.6,
        switchEdgeHold: 0.6,
      },
      landing: { impactMax: 0.85, pitchMax: 0.75 },
      air: { spinRate: 0.8, flipRate: 0.8, lincolnRate: 0.8 },
    },
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
    /**
     * On the Skis tab the camera looks down at the skis: the aim's height
     * above the feet, half the length (m) kept in view, and how steeply it
     * looks down (radians).
     */
    skiAim: 0.1,
    skiHalfLength: 1.15,
    skiPitch: 0.9,
    /** Stat bars: the park ski fills half; each 0.1 a ski's stat is over or under 1 moves the bar this share of 0.1. */
    statGain: 1.4,
  },

  /**
   * Sound (src/audio): every sound is made at startup with Web Audio, no
   * files. Gains are shares of full scale before the Settings sliders; the
   * riding sounds lead and the ambience sits well under them (the user's
   * pick: a quiet bed, about a quarter of the carve; the blizzard about half).
   */
  audio: {
    /** Slider to gain: gain = slider ^ volumeCurve, so the slider sounds even along its length. */
    volumeCurve: 2,
    /** Time constant (s) the game sounds fade out with on pause (and back in on resume). */
    pauseFade: 0.04,
    /** Time constant (s) the continuous sounds follow their targets with. */
    smooth: 0.06,
    /** A continuous sound's target must move this share (or 0.001 of gain) before it's sent again. */
    epsilon: 0.01,
    /** Most one-shots playing at once; any more are dropped. */
    maxOneShots: 10,
    /** Seconds of each looped noise made at startup. */
    noiseSeconds: 2.5,
    /** Sample rate (Hz) the one-shots and the long ambient loops are made at (the loops have nothing high up). */
    shotRate: 44100,
    loopRate: 22050,
    /** How far (0..1) a sound off to one side pans toward that ear. */
    pan: 0.75,

    /** One-shots: gain at full strength, and the random spread of pitch each time it plays (±share). */
    shots: {
      pop: { gain: 0.5, spread: 0.08 },
      landSoft: { gain: 0.55, spread: 0.1 },
      landHard: { gain: 0.8, spread: 0.08 },
      bail: { gain: 0.75, spread: 0.06 },
      pole: { gain: 0.18, spread: 0.12 },
      railMetal: { gain: 0.45, spread: 0.06 },
      railWood: { gain: 0.55, spread: 0.08 },
      cheer: { gain: 0.33, spread: 0.05 },
      jeer: { gain: 0.3, spread: 0.05 },
      liftCheer: { gain: 0.24, spread: 0.08 },
      liftJeer: { gain: 0.24, spread: 0.08 },
      bank: { gain: 0.22, spread: 0 },
      best: { gain: 0.28, spread: 0 },
      lost: { gain: 0.25, spread: 0 },
      click: { gain: 0.22, spread: 0.06 },
      tick: { gain: 0.05, spread: 0.04 },
    },
    /** The pop: strength from the crouch, at least `min` of full (an ollie or nollie pops at full). */
    pop: { min: 0.45 },
    /** Landings by impact (m/s into the snow): silent under `min`, soft up to `hard`, hard from there, full strength at `full`. */
    landing: { min: 1.2, hard: 7, full: 14 },
    /** Onto a rail or box: strength from the speed along it, full at `full` m/s. */
    railOn: { min: 0.35, full: 10 },

    /** Snow hiss: by speed (m/s) and edge (lean, rad); band-pass from freqLow to freqHigh with speed, brighter on edge. */
    carve: { gain: 0.67, speedMin: 1.5, speedFull: 24, edgeBase: 0.4, edgeMin: 0.15, edgeFull: 0.75, freqLow: 700, freqHigh: 2300, edgeFreq: 1.3, q: 0.8, powderGain: 0.8, powderFreq: 0.55 },
    /** Braking or a hockey stop: a gritty scrape by speed. */
    brake: { gain: 0.7, speedMin: 1, speedFull: 12, freqLow: 650, freqHigh: 1700, q: 1.1 },
    /** Tumbling and sliding in a crash, on the carve's voice. */
    slide: { gain: 0.38, speedFull: 14, freq: 900 },
    /** Rushing air by speed: quieter on the snow (under the carve), fuller and brighter in the air. */
    wind: { speedMin: 5, speedFull: 34, ground: 0.15, air: 0.5, freqLow: 260, freqHigh: 1000, airFreq: 1.35, q: 0.55 },
    /** Sliding a rail or box: metal rings, everything else (wood, stone, plastic) rumbles. Low-pass from freqLow to freqHigh by speed; braking adds grit. */
    rail: {
      speedMin: 0.5,
      speedFull: 12,
      brake: 0.7,
      metal: { gain: 0.32, freqLow: 2000, freqHigh: 9000 },
      other: { gain: 0.34, freqLow: 500, freqHigh: 2400 },
    },

    /**
     * Weather ambience: a low bed of noise (low-passed at `freq`) and a howl
     * (band-passed, Q `q`) that follows the snow effects' gusts: its gain
     * moves by `gustGain` and its pitch by `gustFreq` per unit of gust.
     */
    weather: {
      bluebird: { bed: 0.006, bedFreq: 380, howl: 0.008, howlFreq: 420, q: 1.2, gustGain: 1, gustFreq: 0.3 },
      overcast: { bed: 0.033, bedFreq: 420, howl: 0.053, howlFreq: 460, q: 2, gustGain: 1.2, gustFreq: 0.35 },
      blizzard: { bed: 0.092, bedFreq: 340, howl: 0.14, howlFreq: 520, q: 5, gustGain: 1.6, gustFreq: 0.55 },
      night: { bed: 0.021, bedFreq: 520, howl: 0.004, howlFreq: 380, q: 1, gustGain: 0.6, gustFreq: 0.2 },
    },
    /** Seconds the ambience takes to cross-fade to another weather. */
    weatherFade: 0.8,

    /**
     * Places that sound: full gain within `near` m, gone past `far`. The
     * crowd is the spectators (`skier` props), louder the more stand near
     * (`full` of them within `far` is full); the town is the buildings; the
     * lift hum is loudest at the stations (`station` × near the cable).
     */
    crowd: { gain: 0.055, near: 12, far: 110, full: 60, cell: 15 },
    town: { gain: 0.064, near: 25, far: 150 },
    lift: { gain: 0.042, near: 6, far: 80, station: 1.6, stationNear: 10, stationFar: 110 },
    /**
     * Reactions: spectators within `range` m cheer a clean landing (after at
     * least `minAir` s in the air) and jeer a crash; so do the riders on a
     * chairlift when it happens within `liftRange` m of its cable (seen from above).
     */
    cheer: { range: 70, minAir: 0.8, liftRange: 30 },
    /** Menus: a soft click when something is picked; focus moving ticks (this quiet) unless the mouse just clicked. */
    tickAfterPointer: 0.4,
  },

  debug: {
    /** Seconds between frame-rate readout updates. */
    fpsInterval: 0.5,
  },
};
