// Shared humanoid skeleton definition: bone ids, hierarchy and bind-pose landmarks.
// The bind pose is an A-pose: the arms hang ARM_ANGLE away from vertical.
// Characters face +Z and their left side is +X.

export const B = {
  PELVIS: 0, SPINE: 1, CHEST: 2, HEAD: 3,
  UARM_L: 4, FARM_L: 5, HAND_L: 6,
  UARM_R: 7, FARM_R: 8, HAND_R: 9,
  THIGH_L: 10, SHIN_L: 11, FOOT_L: 12,
  THIGH_R: 13, SHIN_R: 14, FOOT_R: 15,
};
export const BONE_COUNT = 16;
export const PARENT = [-1, 0, 1, 2, 2, 4, 5, 2, 7, 8, 0, 10, 11, 0, 13, 14];
export const BONE_NAMES = [
  'Pelvis', 'Stomach', 'Chest', 'Head',
  'Left upper arm', 'Left forearm', 'Left hand',
  'Right upper arm', 'Right forearm', 'Right hand',
  'Left thigh', 'Left shin', 'Left foot',
  'Right thigh', 'Right shin', 'Right foot',
];

export const ARM_ANGLE = (38 * Math.PI) / 180; // A-pose: angle of the arms from vertical

export const BODY_TYPES = {
  male: {
    name: 'male', height: 1.0, shoulder: 1.0, hip: 1.0, waist: 1.0, girth: 1.0, limb: 1.0,
    belly: 1.0, chest: 'male', head: 1.0, mass: 75,
  },
  female: {
    name: 'female', height: 0.945, shoulder: 0.86, hip: 1.06, waist: 0.84, girth: 0.9, limb: 0.88,
    belly: 0.9, chest: 'female', head: 0.95, mass: 62,
  },
  heavy: {
    name: 'heavy', height: 0.99, shoulder: 1.06, hip: 1.12, waist: 1.3, girth: 1.18, limb: 1.15,
    belly: 1.55, chest: 'male', head: 1.02, mass: 102,
  },
  slim: {
    name: 'slim', height: 1.04, shoulder: 0.95, hip: 0.95, waist: 0.9, girth: 0.88, limb: 0.86,
    belly: 0.85, chest: 'male', head: 0.98, mass: 66,
  },
};

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** Compute bind-pose landmarks (in metres, feet on y = 0) for a body type. */
export function makeSkeleton(type) {
  const p = typeof type === 'string' ? BODY_TYPES[type] : type;
  const h = p.height;
  const Y = (y) => y * h;
  const sw = p.shoulder;
  const hw = p.hip;
  const sa = Math.sin(ARM_ANGLE);
  const ca = Math.cos(ARM_ANGLE);

  const j = {};
  j.waist = [0, Y(1.04), 0];
  j.chestJ = [0, Y(1.215), 0];
  j.neck = [0, Y(1.475), -0.012];
  j.headC = [0, Y(1.62), 0.012];
  j.pelvisC = [0, Y(0.965), -0.005];
  j.spineC = [0, Y(1.125), 0.0];
  j.chestC = [0, Y(1.33), 0.0];

  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const dir = [s * sa, -ca, 0];
    const shoulder = [s * 0.178 * sw, Y(1.42), -0.012];
    const elbow = add(shoulder, scale(dir, 0.285 * h));
    const wrist = add(elbow, scale(dir, 0.255 * h));
    const handTip = add(wrist, scale(dir, 0.185 * h));
    j['shoulder' + side] = shoulder;
    j['elbow' + side] = elbow;
    j['wrist' + side] = wrist;
    j['handTip' + side] = handTip;
    j['armDir' + side] = dir;
    const hip = [s * 0.09 * hw, Y(0.915), 0.0];
    const knee = [s * 0.097 * Math.max(1, hw * 0.95), Y(0.5), 0.012];
    const ankle = [s * 0.095 * Math.max(1, hw * 0.95), 0.085, -0.012];
    const toe = [s * 0.105 * Math.max(1, hw * 0.95), 0.04, 0.165 * Math.min(1.05, h)];
    j['hip' + side] = hip;
    j['knee' + side] = knee;
    j['ankle' + side] = ankle;
    j['toe' + side] = toe;
  }

  const centers = new Array(16);
  centers[B.PELVIS] = j.pelvisC;
  centers[B.SPINE] = j.spineC;
  centers[B.CHEST] = j.chestC;
  centers[B.HEAD] = j.headC;
  centers[B.UARM_L] = mid(j.shoulderL, j.elbowL);
  centers[B.FARM_L] = mid(j.elbowL, j.wristL);
  centers[B.HAND_L] = mid(j.wristL, j.handTipL);
  centers[B.UARM_R] = mid(j.shoulderR, j.elbowR);
  centers[B.FARM_R] = mid(j.elbowR, j.wristR);
  centers[B.HAND_R] = mid(j.wristR, j.handTipR);
  centers[B.THIGH_L] = mid(j.hipL, j.kneeL);
  centers[B.SHIN_L] = mid(j.kneeL, j.ankleL);
  centers[B.FOOT_L] = [j.ankleL[0], 0.05, 0.05];
  centers[B.THIGH_R] = mid(j.hipR, j.kneeR);
  centers[B.SHIN_R] = mid(j.kneeR, j.ankleR);
  centers[B.FOOT_R] = [j.ankleR[0], 0.05, 0.05];

  return { params: p, j, centers, height: h };
}
