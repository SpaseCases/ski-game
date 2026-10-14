// Dev-only live tuning panel. main.ts loads this with a dynamic import behind
// import.meta.env.DEV, so neither this file nor lil-gui reaches production.
import GUI from 'lil-gui';
import { CONFIG } from '../config.ts';
import type { SkierPose } from '../render/skierView.ts';

export interface DevPanel {
  update(pose: SkierPose): void;
}

export function mountDevPanel(actions: { respawn: () => void }): DevPanel {
  const gui = new GUI({ title: 'Tuning (dev only)', width: 290 });
  // Keep the top-right corner free for the window buttons.
  gui.domElement.style.left = '0';
  gui.domElement.style.right = 'auto';

  const readout = { speed: '0 km/h', state: 'riding' };
  gui.add(readout, 'speed').name('Speed').listen().disable();
  gui.add(readout, 'state').name('State').listen().disable();
  gui.add(actions, 'respawn').name('Respawn (R)');
  gui.add({ copy: copyConfig }, 'copy').name('Copy config as JSON');

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
  cam.close();

  return {
    update(pose: SkierPose): void {
      readout.speed = `${Math.round(pose.velocity.length() * 3.6)} km/h`;
      readout.state = pose.grounded ? 'riding' : 'air';
    },
  };
}

function copyConfig(): void {
  const json = JSON.stringify(CONFIG, null, 2);
  navigator.clipboard.writeText(json).catch(() => {
    console.info(json);
  });
}
