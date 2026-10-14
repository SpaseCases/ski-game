import { BoxGeometry, Group, Mesh, MeshLambertMaterial, type Object3D } from 'three';

// Greybox skier: boxes on a simple joint hierarchy, posed procedurally.
//   root (feet on the snow, tilted to the slope, turned to the ski heading)
//   └ twist (hockey-stop swing) └ lean (roll into the turn)
//       ├ skis, boots
//       ├ legs: shin pivot → knee pivot
//       └ hips → torso pivot → head, arms → poles
// Forward is -Z in every local frame.

const SHIN = 0.42;
const THIGH = 0.42;
const BOOT_TOP = 0.15;
const TORSO = 0.5;
const ARM = 0.55;
const POLE = 1.1;

export interface Outfit {
  jacket: string;
  pants: string;
  helmet: string;
}

export const DEFAULT_OUTFIT: Outfit = { jacket: '#e2553f', pants: '#2c3d5b', helmet: '#eef1f4' };

export interface PoseParams {
  crouch: number;
  lean: number;
  /** Radians the skier swings sideways for a hockey stop. */
  twist: number;
  /** 0..1 pole push progress; 1 when idle. */
  polePhase: number;
}

export class SkierModel {
  readonly root = new Group();
  private readonly twist = new Group();
  private readonly lean = new Group();
  private readonly shins: Group[] = [];
  private readonly knees: Group[] = [];
  private readonly hips = new Group();
  private readonly torso = new Group();
  private readonly shoulders: Group[] = [];
  private readonly poles: Group[] = [];

  constructor(outfit: Outfit = DEFAULT_OUTFIT) {
    const mat = (color: string): MeshLambertMaterial => new MeshLambertMaterial({ color, flatShading: true });
    const jacket = mat(outfit.jacket);
    const pants = mat(outfit.pants);
    const helmet = mat(outfit.helmet);
    const dark = mat('#1b222b');
    const boot = mat('#3a4250');
    const ski = mat('#f2c230');
    const pole = mat('#c8ced6');

    this.root.add(this.twist);
    this.twist.add(this.lean);

    for (const side of [-1, 1]) {
      // Ski with raised twin tips.
      const skiGroup = new Group();
      skiGroup.position.set(side * 0.13, 0.015, 0);
      skiGroup.add(box(0.1, 0.03, 1.6, ski));
      for (const end of [-1, 1]) {
        const tip = box(0.1, 0.03, 0.22, ski);
        tip.position.set(0, 0.035, end * 0.89);
        tip.rotation.x = -end * 0.38;
        skiGroup.add(tip);
      }
      this.lean.add(skiGroup);

      const bootMesh = box(0.13, BOOT_TOP, 0.3, boot);
      bootMesh.position.set(side * 0.13, 0.03 + BOOT_TOP / 2, 0.02);
      this.lean.add(bootMesh);

      // Leg: shin pivots at the boot, thigh at the knee.
      const shin = new Group();
      shin.position.set(side * 0.12, BOOT_TOP, 0);
      shin.add(raised(box(0.14, SHIN, 0.16, pants), SHIN));
      const knee = new Group();
      knee.position.y = SHIN;
      knee.add(raised(box(0.15, THIGH, 0.17, pants), THIGH));
      shin.add(knee);
      this.lean.add(shin);
      this.shins.push(shin);
      this.knees.push(knee);
    }

    // Upper body.
    this.lean.add(this.hips);
    this.hips.add(this.torso);
    this.torso.add(raised(box(0.4, TORSO, 0.24, jacket), TORSO));
    const head = box(0.25, 0.26, 0.27, helmet);
    head.position.y = TORSO + 0.16;
    this.torso.add(head);
    const goggles = box(0.21, 0.08, 0.04, dark);
    goggles.position.set(0, TORSO + 0.15, -0.14);
    this.torso.add(goggles);

    for (const side of [-1, 1]) {
      const shoulder = new Group();
      shoulder.position.set(side * 0.25, TORSO - 0.06, 0);
      shoulder.rotation.z = side * 0.18;
      shoulder.add(raised(box(0.11, ARM, 0.12, jacket), -ARM));
      const hand = box(0.1, 0.1, 0.1, dark);
      hand.position.y = -ARM;
      shoulder.add(hand);

      const polePivot = new Group();
      polePivot.position.y = -ARM;
      polePivot.add(raised(box(0.025, POLE, 0.025, pole), -POLE));
      shoulder.add(polePivot);
      this.torso.add(shoulder);
      this.shoulders.push(shoulder);
      this.poles.push(polePivot);
    }
  }

  /** Sets the joint angles. The caller places and orients `root`. */
  pose(p: PoseParams): void {
    const c = p.crouch;
    this.twist.rotation.y = p.twist;
    this.lean.rotation.z = p.lean;

    // Knees bend forward, hips drop and move back.
    const shinTilt = 0.18 + 0.55 * c;
    const thighTilt = 0.12 + 1.05 * c;
    for (let i = 0; i < 2; i++) {
      this.shins[i]?.rotation.set(-shinTilt, 0, 0);
      this.knees[i]?.rotation.set(shinTilt + thighTilt, 0, 0);
    }
    this.hips.position.set(
      0,
      BOOT_TOP + SHIN * Math.cos(shinTilt) + THIGH * Math.cos(thighTilt),
      -SHIN * Math.sin(shinTilt) + THIGH * Math.sin(thighTilt),
    );
    this.torso.rotation.x = -(0.2 + 0.85 * c);

    // Arms forward, more so when tucked; a pole push swings them forward then back.
    const ph = p.polePhase;
    const swing = 0.9 * Math.sin(ph * Math.PI * 2) * (1 - ph);
    for (let i = 0; i < 2; i++) {
      this.shoulders[i]?.rotation.set(0.5 + 0.5 * c + swing, 0, (i === 0 ? -1 : 1) * 0.18);
      this.poles[i]?.rotation.set(-1 - 0.6 * c - 0.6 * swing, 0, 0);
    }
  }
}

function box(w: number, h: number, d: number, material: MeshLambertMaterial): Mesh {
  return new Mesh(new BoxGeometry(w, h, d), material);
}

/** Shifts a part so it extends from its pivot along +Y (or -Y for negative length). */
function raised<T extends Object3D>(part: T, length: number): T {
  part.position.y = length / 2;
  return part;
}
