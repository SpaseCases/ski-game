// The live tuning panel (lil-gui), in every build. main.ts loads this with a
// dynamic import only when the Cheats screen opens it (dev builds open it at
// startup, folded up), so neither this file nor lil-gui is in the first
// load. It edits CONFIG, the base numbers; every change rebuilds the sim's
// TUNING. Changes last until reload; Reset puts back config.ts's values.
// Keys pressed while the panel has focus never reach the skier or the menus
// (see core/input.ts inTuningPanel).
import GUI from 'lil-gui';
import { CONFIG } from '../config.ts';
import { QUALITIES, type Quality } from '../core/settings.ts';
import type { MapDef } from '../maps/types.ts';
import type { SkierPose } from '../render/skierView.ts';
import type { SkierState } from '../sim/skier.ts';
import { rebuildTuning, resetConfig } from '../sim/tuning.ts';

export interface TuningPanel {
  update(pose: SkierPose, skier: SkierState): void;
  /** Lists the test spots of a newly loaded map. */
  setMap(map: MapDef): void;
  readonly isOpen: boolean;
  /** Shows the panel, unfolded unless `folded`. */
  open(folded?: boolean): void;
  close(): void;
}

export interface PanelActions {
  /** A number changed (or was reset): the sim's numbers were rebuilt. */
  changed: () => void;
  /** The panel was shown or hidden. */
  shown: (open: boolean) => void;
  respawn: () => void;
  backToTop: () => void;
  /** Puts the skier at (x, z) facing `heading` (radians), moving at `speed` m/s. */
  teleport: (x: number, z: number, heading: number, speed: number) => void;
  setQuality: (q: Quality) => void;
  quality: Quality;
}

const DEG = 180 / Math.PI;

/** A place to test from: x, z, and heading in radians. */
export interface TestSpot {
  x: number;
  z: number;
  heading: number;
}

/**
 * Places to try each feature from: every start gate and flag, the top of
 * each run, a run-up before each jump, kicker, landing, rail and box, the
 * halfpipe's drop-in deck, and the slalom's first gate.
 */
export function testSpots(map: MapDef): Record<string, TestSpot> {
  const spots: Record<string, TestSpot> = { spawn: { x: map.spawn.x, z: map.spawn.z, heading: map.spawn.heading / DEG } };
  const count: Record<string, number> = {};
  const name = (kind: string): string => {
    count[kind] = (count[kind] ?? 0) + 1;
    return `${kind} ${count[kind]}`;
  };
  /** `back` meters before (x, z), facing heading (degrees). */
  const before = (x: number, z: number, heading: number, back: number): TestSpot => {
    const h = heading / DEG;
    return { x: x + Math.sin(h) * back, z: z + Math.cos(h) * back, heading: h };
  };
  map.flags.forEach((f, i) => {
    spots[`flag ${i + 1}`] = before(f.x, f.z, f.heading, 8);
  });
  for (const run of map.runs) {
    const [a, b] = run.points;
    if (a && b) spots[`run: ${run.name}`] = { x: a.x, z: a.z, heading: Math.atan2(-(b.x - a.x), -(b.z - a.z)) };
  }
  for (const f of map.features) {
    switch (f.type) {
      case 'start':
        spots[f.course === '' ? `start: ${f.style}` : `start: ${f.course}`] = { x: f.x, z: f.z, heading: f.heading / DEG };
        break;
      case 'jump':
      case 'kicker':
        spots[name(f.type)] = before(f.x, f.z, f.yaw, 30);
        break;
      case 'landing':
        spots[name('landing')] = before(f.x, f.z, f.yaw, 10);
        break;
      case 'halfpipe':
        spots[name('halfpipe deck')] = before(f.x, f.z, f.yaw, -f.dropIn / 2);
        break;
      case 'rail':
      case 'box': {
        const [a, b] = f.points;
        if (!a || !b) break;
        const heading = Math.atan2(-(b.x - a.x), -(b.z - a.z)) * DEG;
        spots[name(f.type)] = before(a.x, a.z, heading, 20);
        break;
      }
      case 'slalom': {
        const g = f.gates[0];
        if (g) spots[f.name === '' ? name('slalom') : `gates: ${f.name}`] = before(g.x, g.z, g.heading, 25);
        break;
      }
    }
  }
  return spots;
}

export function mountTuningPanel(actions: PanelActions): TuningPanel {
  const gui = new GUI({ title: 'Tuning (until reload)', width: 290 });
  // Down the right, under the window buttons.
  const el = gui.domElement;
  el.classList.add('tuning-panel');
  el.style.top = '52px';
  el.style.right = '8px';
  el.style.maxHeight = 'calc(100% - 60px)';
  // Pressed buttons and picked options let go of focus, so riding keys work again at once.
  el.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('button')) blurActive(el);
  });
  el.addEventListener('change', (e) => {
    if (e.target instanceof HTMLSelectElement) e.target.blur();
  });

  const panel = {
    reset: (): void => {
      resetConfig();
      for (const c of gui.controllersRecursive()) c.updateDisplay();
      actions.changed();
    },
    close: (): void => hide(),
  };
  gui.add(panel, 'close').name('Close panel');
  gui.add(panel, 'reset').name('Reset to config.ts values');

  const readout = { speed: '0 km/h', state: 'riding', landing: '–' };
  gui.add(readout, 'speed').name('Speed').listen().disable();
  gui.add(readout, 'state').name('State').listen().disable();
  gui.add(readout, 'landing').name('Last landing').listen().disable();
  gui.add(actions, 'respawn').name('Respawn (R)');
  gui.add(actions, 'backToTop').name('Back to top (hold R)');
  gui.add({ copy: copyConfig }, 'copy').name('Copy config as JSON');
  gui
    .add({ quality: actions.quality }, 'quality', QUALITIES)
    .name('Quality (decor)')
    .onChange((q: Quality) => actions.setQuality(q));

  let spots: Record<string, TestSpot> = {};
  const go = {
    spot: 'spawn',
    speed: 0,
    go: (): void => {
      const s = spots[go.spot];
      if (s) actions.teleport(s.x, s.z, s.heading, go.speed);
    },
  };
  const test = gui.addFolder('Test spots');
  /** Rebuilds the folder for this map's spots (a dropdown's options can't change in place). */
  const fillSpots = (): void => {
    for (const c of [...test.controllers]) c.destroy();
    go.spot = 'spawn';
    test.add(go, 'spot', Object.keys(spots)).name('Spot');
    test.add(go, 'speed', 0, 30, 0.5).name('Speed (m/s)');
    test.add(go, 'go').name('Go there');
  };

  const s = CONFIG.skier;
  const ride = gui.addFolder('Riding');
  ride.add(s, 'gravity', 5, 20, 0.1);
  ride.add(s, 'skiFriction', 0, 0.3, 0.005);
  ride.add(s, 'dragStand', 0, 0.02, 0.0005);
  ride.add(s, 'dragCrouch', 0, 0.02, 0.0005);
  ride.add(s, 'dragAir', 0, 0.02, 0.0005);
  ride.add(s, 'brakeDecel', 0, 20, 0.1);
  ride.add(s, 'brakeRampTime', 0.01, 1, 0.01);

  const carve = gui.addFolder('Carving');
  carve.add(s, 'grip', 0.2, 5, 0.05);
  carve.add(s, 'carveFriction', 0, 0.5, 0.01);
  carve.add(s, 'carveSlipMax', 0.1, 1.5, 0.01);
  carve.add(s, 'skidFriction', 0, 2, 0.01);
  carve.add(s, 'edgeHold', 0, 2, 0.01);
  carve.add(s, 'switchGrip', 0, 2, 0.01);
  carve.add(s, 'switchEdgeHold', 0, 2, 0.01);
  carve.add(s, 'switchSpeed', 0.1, 10, 0.1);
  carve.add(s, 'turnRateSlow', 0.2, 6, 0.05);
  carve.add(s, 'turnRateFast', 0.2, 6, 0.05);
  carve.add(s, 'turnSpeedRef', 1, 40, 0.5);
  carve.add(s, 'turnResponse', 1, 60, 0.5);
  carve.add(s, 'leanMax', 0, 1.4, 0.01);
  carve.add(s, 'leanResponse', 1, 30, 0.5);

  const pop = gui.addFolder('Pole push, crouch and pop');
  pop.add(s, 'polePushSpeed', 0, 6, 0.05);
  pop.add(s, 'poleMaxSpeed', 0, 20, 0.1);
  pop.add(s, 'polePlantTime', 0, 0.5, 0.01);
  pop.add(s, 'polePushTime', 0.05, 1.5, 0.01);
  pop.add(s, 'polePushInterval', 0.1, 2, 0.01);
  pop.add(s, 'crouchTime', 0.01, 1, 0.01);
  pop.add(s, 'standTime', 0.01, 1, 0.01);
  pop.add(s, 'popMin', 0, 10, 0.1);
  pop.add(s, 'popMax', 0, 12, 0.1);
  pop.add(s, 'popCoyoteTime', 0, 0.5, 0.01);
  pop.add(s, 'groundTolerance', 0, 0.3, 0.005);

  const a = CONFIG.air;
  const air = gui.addFolder('Air');
  air.add(a, 'spinRate', 0, 15, 0.1);
  air.add(a, 'flipRate', 0, 15, 0.1);
  air.add(a, 'lincolnRate', 0, 15, 0.1);
  air.add(a, 'rotateAccel', 1, 80, 0.5);
  air.add(a, 'rotateStop', 0, 80, 0.5);
  air.add(a, 'spinCarry', 0, 3, 0.05);
  air.add(a, 'spinPreload', 0, 8, 0.1);
  air.add(a, 'pathAlign', 0, 10, 0.1);
  air.add(a, 'pathSpeedMin', 0, 20, 0.5);
  air.add(a, 'pathSpeedFull', 0, 30, 0.5);
  air.add(a, 'comHeight', 0, 1.5, 0.01);
  air.add(a, 'headHeight', 0.5, 2.2, 0.01);
  air.close();

  const L = CONFIG.landing;
  const land = gui.addFolder('Landing');
  land.add(L, 'pitchMax', 0.05, 1.6, 0.01);
  land.add(L, 'rollMax', 0.05, 1.6, 0.01);
  land.add(L, 'edgeCheckAir', 0, 1, 0.01);
  land.add(L, 'sideMax', 0.05, 1.6, 0.01);
  land.add(L, 'sideSpeed', 0, 20, 0.5);
  land.add(L, 'impactMax', 1, 40, 0.5);
  land.add(L, 'squashImpact', 1.5, 30, 0.5);
  land.add(L, 'squashTime', 0.05, 1, 0.01);
  land.close();

  const R = CONFIG.rails;
  const rails = gui.addFolder('Rails and boxes');
  rails.add(R, 'snapDistance', 0, 1, 0.01);
  rails.add(R, 'catchDepth', 0.05, 1, 0.01);
  rails.add(R, 'angleMax', 0.05, 0.78, 0.01);
  rails.add(R, 'tiltMax', 0.05, 1.6, 0.01);
  rails.add(R, 'railFriction', 0, 0.5, 0.005);
  rails.add(R, 'boxFriction', 0, 0.5, 0.005);
  rails.add(R, 'turnRate', 0.5, 15, 0.1);
  rails.add(R, 'turnAccel', 1, 100, 1);
  rails.add(R, 'spinCarry', 0, 2, 0.05);
  rails.add(R, 'slipSpeed', 0, 5, 0.1);
  rails.add(R, 'bodyRadius', 0.05, 0.6, 0.01);
  rails.add(R, 'stepTolerance', 0, 0.5, 0.01);
  rails.add(R, 'crashSpeed', 0, 20, 0.5);
  rails.close();

  const b = CONFIG.bail;
  const bail = gui.addFolder('Crash');
  bail.add(b, 'friction', 0, 2, 0.01);
  bail.add(b, 'impactLoss', 0, 1, 0.01);
  bail.add(b, 'rollRadius', 0.1, 2, 0.01);
  bail.add(b, 'tumbleScale', 0, 2, 0.01);
  bail.add(b, 'respawnDelay', 0, 5, 0.1);
  bail.add(b, 'fadeTime', 0.05, 2, 0.05);
  bail.close();

  // Each ski's multipliers (config.ts's skis block); the ski in use rides on them at once.
  const skis = gui.addFolder('Skis (multipliers)');
  for (const [id, scale] of Object.entries(CONFIG.skis)) {
    const blocks = Object.entries(scale as Record<string, Record<string, number>>);
    if (blocks.length === 0) continue;
    const f = skis.addFolder(id);
    for (const [block, keys] of blocks) for (const key of Object.keys(keys)) f.add(keys, key, 0, 3, 0.01).name(`${block}.${key}`);
  }
  skis.close();

  const look = gui.addFolder('Skier look');
  const r = CONFIG.render;
  look.add(r, 'tuckSpeedMin', 0, 30, 0.5);
  look.add(r, 'tuckSpeedFull', 0, 40, 0.5);
  look.add(r, 'brakeTwist', 0, 1.6, 0.01);
  look.add(r, 'brakeCounter', 0, 1, 0.01);
  look.add(r, 'brakeLean', 0, 0.8, 0.01);
  look.add(r, 'brakeSink', 0, 1, 0.01);
  look.add(r, 'tiltSmoothing', 1, 30, 0.5);
  look.add(r, 'leanBodyShare', 0, 1, 0.01);
  look.add(r, 'crouchAngulation', 0, 1, 0.01);
  look.add(r, 'hipShift', 0, 1, 0.01);
  look.add(r, 'kneeDrive', 0, 3, 0.05);
  look.add(r, 'grabBlendTime', 0.01, 0.5, 0.01);
  look.add(r, 'airCrouch', 0, 1, 0.01);
  look.add(r, 'spinTuck', 0, 1, 0.01);
  look.add(r, 'bailBlendTime', 0.01, 1, 0.01);
  look.add(r, 'railCrouch', 0, 1, 0.01);
  look.add(r, 'railBlendTime', 0.01, 0.5, 0.01);
  look.close();

  // Snow effects read these every frame; the per-preset budgets apply when a map loads or the quality changes.
  const fx = gui.addFolder('Snow effects');
  const F = CONFIG.snowFx;
  for (const key of ['trackSpacing', 'trackWidth', 'trackOpacity', 'skiLength', 'smearOpacity', 'smearMax', 'windSpeed'] as const) {
    fx.add(F, key, 0, F[key] * 4 || 1, 0.01);
  }
  for (const block of ['carve', 'brake', 'spray', 'powder', 'landing', 'crash', 'sparks', 'ridge'] as const) {
    const f = fx.addFolder(block);
    const values = F[block] as Record<string, number>;
    for (const key of Object.keys(values)) f.add(values, key, 0, values[key]! * 4 || 1, 0.01);
    f.close();
  }
  fx.close();

  const cam = gui.addFolder('Camera');
  const c = CONFIG.camera;
  cam.add(c, 'distNear', 1, 15, 0.1);
  cam.add(c, 'distFar', 1, 20, 0.1);
  cam.add(c, 'heightNear', 0, 8, 0.05);
  cam.add(c, 'heightFar', 0, 10, 0.05);
  cam.add(c, 'speedForFar', 1, 50, 0.5);
  cam.add(c, 'lookHeight', 0, 4, 0.05);
  cam.add(c, 'lookAhead', 0, 10, 0.1);
  cam.add(c, 'yawSmoothing', 0.5, 20, 0.1);
  cam.add(c, 'heightSmoothingGround', 0.5, 30, 0.5);
  cam.add(c, 'heightSmoothingAir', 0.5, 30, 0.5);
  cam.add(c, 'clearance', 0, 3, 0.05);
  cam.add(c, 'slopeLift', 0, 1.5, 0.05);
  cam.add(c, 'slopeLiftMax', 0, 15, 0.5);
  cam.add(c, 'orbitSensitivity', 0.001, 0.02, 0.0005);
  cam.add(c, 'orbitPitchMin', -1, 0, 0.05);
  cam.add(c, 'orbitPitchMax', 0, 1.2, 0.05);
  cam.add(c, 'orbitHoldSpeed', 0, 10, 0.1);
  cam.add(c, 'orbitReturnDelay', 0, 5, 0.1);
  cam.add(c, 'orbitReturnRate', 0.1, 10, 0.1);
  cam.close();

  // Every number edited here changes the sim's numbers at once.
  gui.onChange(() => {
    rebuildTuning();
    actions.changed();
  });

  let shown = true;
  const hide = (): void => {
    gui.hide();
    shown = false;
    actions.shown(false);
  };

  return {
    get isOpen(): boolean {
      return shown;
    },
    open(folded = false): void {
      gui.show();
      if (folded) gui.close();
      else gui.open();
      shown = true;
      actions.shown(true);
    },
    close: hide,
    setMap(map: MapDef): void {
      spots = testSpots(map);
      fillSpots();
    },
    update(pose: SkierPose, skier: SkierState): void {
      readout.speed = `${Math.round(pose.velocity.length() * 3.6)} km/h`;
      readout.state = skier.bailed
        ? `crash (${skier.bailReason})`
        : skier.rail >= 0
          ? `rail ${skier.rail} (${Math.round(skier.railAngle * DEG)}°)`
          : pose.grounded
            ? 'riding'
            : 'air';
      readout.landing =
        `${skier.bailReason && skier.bailed ? 'BAIL ' : ''}pitch ${Math.round(skier.landPitch * DEG)}° roll ${Math.round(skier.landRoll * DEG)}° ` +
        `side ${Math.round(skier.landSide * DEG)}° ${skier.landImpact.toFixed(1)} m/s`;
    },
  };
}

function blurActive(within: HTMLElement): void {
  const a = document.activeElement;
  if (a instanceof HTMLElement && within.contains(a)) a.blur();
}

function copyConfig(): void {
  const json = JSON.stringify(CONFIG, null, 2);
  navigator.clipboard.writeText(json).catch(() => {
    console.info(json);
  });
}
