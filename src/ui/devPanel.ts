// Dev-only live tuning panel. main.ts loads this with a dynamic import behind
// import.meta.env.DEV, so neither this file nor lil-gui reaches production.
import GUI from 'lil-gui';
import { CONFIG } from '../config.ts';
import { QUALITIES, type Quality } from '../core/settings.ts';
import type { MapDef } from '../maps/types.ts';
import type { SkierPose } from '../render/skierView.ts';
import type { SkierState } from '../sim/skier.ts';

export interface DevPanel {
  update(pose: SkierPose, skier: SkierState): void;
}

export interface DevActions {
  respawn: () => void;
  backToTop: () => void;
  /** Puts the skier at (x, z) facing `heading` (radians), moving at `speed` m/s. */
  teleport: (x: number, z: number, heading: number, speed: number) => void;
  setQuality: (q: Quality) => void;
  quality: Quality;
  map: MapDef;
}

const DEG = 180 / Math.PI;

/** A place to test from: x, z, and heading in radians. */
export interface TestSpot {
  x: number;
  z: number;
  heading: number;
}

/**
 * Places to try each feature from: every start gate, a run-up before each
 * jump, kicker, landing, rail and box, the halfpipe's drop-in deck, and the
 * slalom's first gate.
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
  for (const f of map.features) {
    switch (f.type) {
      case 'start':
        spots[`start: ${f.style}`] = { x: f.x, z: f.z, heading: f.heading / DEG };
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
        if (g) spots[name('slalom')] = before(g.x, g.z, g.heading, 25);
        break;
      }
    }
  }
  return spots;
}

export function mountDevPanel(actions: DevActions): DevPanel {
  const gui = new GUI({ title: 'Tuning (dev only)', width: 290 });
  // Keep the top-right corner free for the window buttons.
  gui.domElement.style.left = '0';
  gui.domElement.style.right = 'auto';

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

  const spots = testSpots(actions.map);
  const go = { spot: 'spawn', speed: 0 };
  const test = gui.addFolder('Test spots');
  test.add(go, 'spot', Object.keys(spots)).name('Spot');
  test.add(go, 'speed', 0, 30, 0.5).name('Speed (m/s)');
  test
    .add(
      {
        go: (): void => {
          const s = spots[go.spot];
          if (s) actions.teleport(s.x, s.z, s.heading, go.speed);
        },
      },
      'go',
    )
    .name('Go there');

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
  cam.add(c, 'orbitSensitivity', 0.001, 0.02, 0.0005);
  cam.add(c, 'orbitPitchMin', -1, 0, 0.05);
  cam.add(c, 'orbitPitchMax', 0, 1.2, 0.05);
  cam.add(c, 'orbitHoldSpeed', 0, 10, 0.1);
  cam.add(c, 'orbitReturnDelay', 0, 5, 0.1);
  cam.add(c, 'orbitReturnRate', 0.1, 10, 0.1);
  cam.close();

  return {
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

function copyConfig(): void {
  const json = JSON.stringify(CONFIG, null, 2);
  navigator.clipboard.writeText(json).catch(() => {
    console.info(json);
  });
}
