/**
 * capRenderer.ts
 * ==============
 * Faithful TypeScript port of face_detector.py + cap_overlay.py.
 *
 * face_detector.py  → extractFaceData(), detectForeheadCovered()
 * cap_overlay.py    → renderCap()
 */

// ── Landmark index groups (face_detector.py lines 17-22) ─────────────────────
const FOREHEAD_TOP = [10, 338, 297, 332, 284, 251, 389];
const LEFT_EYEBROW_TOP  = [70, 63, 105, 66, 107];
const RIGHT_EYEBROW_TOP = [336, 296, 334, 293, 300];
const LEFT_FACE_EDGE  = [234, 227, 116];
const RIGHT_FACE_EDGE = [454, 447, 345];
const CHIN_BOTTOM = [152, 175, 148];

// ── Constants (cap_overlay.py lines 14, 21) ───────────────────────────────────
export const CAP_WIDTH_MULTIPLIER = 1.2;   // line 14
const BRIM_CURVE_RATIO = 0.06;             // line 21

// ── Public types ──────────────────────────────────────────────────────────────
export interface FaceData {
  faceWidth:         number;
  faceHeight:        number;
  faceTopY:          number;
  eyebrowY:          number;
  foreheadHeight:    number;
  faceCenterX:       number;
  angleDeg:          number;   // degrees, as in face_detector.py
  isProfile:         boolean;
  isForeheadCovered: boolean;
  yawRatio:          number;
  imageW:            number;
  imageH:            number;
}

// ────────────────────────────────────────────────────────────────────────────
// face_detector.py → FaceDetector.detect()
// ────────────────────────────────────────────────────────────────────────────

/** Extract face metrics from landmarks. Mirrors FaceDetector.detect() exactly. */
export function extractFaceData(
  landmarks: any[],
  W: number,
  H: number
): FaceData {
  const lm = landmarks;

  // avg_pt helper (face_detector.py lines 53-55)
  const avgPt = (indices: number[]) => ({
    x: indices.reduce((s, i) => s + lm[i].x * W, 0) / indices.length,
    y: indices.reduce((s, i) => s + lm[i].y * H, 0) / indices.length,
  });

  // Bounding metrics (lines 57-60)
  const leftX  = Math.min(...LEFT_FACE_EDGE.map(i => lm[i].x * W));
  const rightX = Math.max(...RIGHT_FACE_EDGE.map(i => lm[i].x * W));
  const topY   = Math.min(...FOREHEAD_TOP.map(i => lm[i].y * H));
  const botY   = Math.max(...CHIN_BOTTOM.map(i => lm[i].y * H));

  // Eyebrow centroids (lines 62-63)
  const leftBrow  = avgPt(LEFT_EYEBROW_TOP);
  const rightBrow = avgPt(RIGHT_EYEBROW_TOP);

  // Sort by x so dx > 0 always (lines 65-69)
  const [pt1, pt2] = leftBrow.x < rightBrow.x
    ? [leftBrow,  rightBrow]
    : [rightBrow, leftBrow];

  // Angle calculation (lines 71-75) — degrees
  const dx = pt2.x - pt1.x;
  const dy = pt2.y - pt1.y;
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;

  // Derived metrics (lines 77-85)
  const faceWidth      = Math.round(rightX - leftX);
  const faceHeight     = Math.round(botY - topY);
  const eyebrowY       = Math.round((leftBrow.y + rightBrow.y) / 2);
  const faceTopY       = Math.round(topY);
  const foreheadHeight = eyebrowY - faceTopY;
  const faceCenterX    = Math.round((leftBrow.x + rightBrow.x) / 2);

  // Yaw / profile detection (lines 87-93)
  const noseX    = lm[1].x * W;
  const leftDist  = Math.max(1.0, noseX - leftX);
  const rightDist = Math.max(1.0, rightX - noseX);
  const yawRatio  = Math.min(leftDist, rightDist) / Math.max(leftDist, rightDist);
  const isProfile = yawRatio < 0.20;

  return {
    faceWidth, faceHeight, faceTopY, eyebrowY, foreheadHeight,
    faceCenterX, angleDeg, isProfile,
    isForeheadCovered: false, // set externally via detectForeheadCovered()
    yawRatio, imageW: W, imageH: H,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// face_detector.py → get_patch_hsv() + forehead covered logic (lines 98-114)
// ────────────────────────────────────────────────────────────────────────────

/** RGB → HSV, returns H∈[0,360], S∈[0,255], V∈[0,255] (matching OpenCV HSV range) */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const v = max;
  const s = max === 0 ? 0 : (max - min) / max;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    if (max === rn)      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else                 h = ((rn - gn) / d + 4) / 6;
  }
  return [h * 360, s * 255, v * 255];
}

/**
 * Sample 5×5 patch median HSV at landmark pixel position.
 * Matches get_patch_hsv() in face_detector.py — using MEDIAN not mean.
 */
function getPatchHsvMedian(
  data: Uint8ClampedArray,
  cx: number, cy: number,
  imgW: number, imgH: number,
  size = 5
): [number, number, number] {
  const half = Math.floor(size / 2);
  // Clamp center (face_detector.py lines 102-103)
  cx = Math.max(half, Math.min(imgW - half - 1, cx));
  cy = Math.max(half, Math.min(imgH - half - 1, cy));

  const hs: number[] = [], ss: number[] = [], vs: number[] = [];
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const px = cx + dx, py = cy + dy;
      if (px < 0 || py < 0 || px >= imgW || py >= imgH) continue;
      const idx = (py * imgW + px) * 4;
      const [h, s, v] = rgbToHsv(data[idx], data[idx + 1], data[idx + 2]);
      hs.push(h); ss.push(s); vs.push(v);
    }
  }
  const med = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[m - 1] + sorted[m]) / 2
      : sorted[m];
  };
  return [med(hs), med(ss), med(vs)];
}

/**
 * Detect forehead covered detection.
 * Exact port of face_detector.py lines 98-114.
 * imageData must be in the SAME coordinate space as landmarks (unmirrored).
 */
export function detectForeheadCovered(
  data: Uint8ClampedArray,
  landmarks: any[],
  W: number,
  H: number
): boolean {
  try {
    const pt = (idx: number) => ({
      x: Math.round(landmarks[idx].x * W),
      y: Math.round(landmarks[idx].y * H),
    });

    // ref_hsv = np.median([get_patch_hsv(4), get_patch_hsv(50), get_patch_hsv(280)], axis=0)
    const cheekSamples = [4, 50, 280].map(i => {
      const p = pt(i);
      return getPatchHsvMedian(data, p.x, p.y, W, H);
    });
    // fh_hsv = np.median([get_patch_hsv(10), get_patch_hsv(151), get_patch_hsv(9)], axis=0)
    const fhSamples = [10, 151, 9].map(i => {
      const p = pt(i);
      return getPatchHsvMedian(data, p.x, p.y, W, H);
    });

    // np.median across samples per channel
    const medChannel = (samples: [number, number, number][], ch: 0 | 1 | 2) => {
      const vals = samples.map(s => s[ch]).sort((a, b) => a - b);
      const m = Math.floor(vals.length / 2);
      return vals.length % 2 === 0 ? (vals[m - 1] + vals[m]) / 2 : vals[m];
    };

    const refH = medChannel(cheekSamples, 0);
    const refS = medChannel(cheekSamples, 1);
    const refV = medChannel(cheekSamples, 2);
    const fhH  = medChannel(fhSamples, 0);
    const fhS  = medChannel(fhSamples, 1);
    const fhV  = medChannel(fhSamples, 2);

    // diff thresholds (face_detector.py line 112): H > 25, S > 55, V > 70
    return (
      Math.abs(refH - fhH) > 25 ||
      Math.abs(refS - fhS) > 55 ||
      Math.abs(refV - fhV) > 70
    );
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// cap_overlay.py → CapOverlay.apply()
// ────────────────────────────────────────────────────────────────────────────

/**
 * Draw the virtual cap on the canvas context.
 *
 * Mirrors the full apply() method in cap_overlay.py:
 *  1. Scale  → face_width * 1.2
 *  2. Perspective warp (simulated via canvas clip path)
 *  3. Find anchor = visual bottom-center of cap (alpha bounding box)
 *  4. Rotate by -angleDeg and transform anchor through rotation matrix
 *  5. Place: cap_top = eyebrowY - anchor_y, cap_left = faceCenterX - anchor_x
 *
 * The ctx must already be set up with the correct mirror transform
 * (translate(W,0) + scale(-1,1)) so that landmark coordinates map to the
 * mirrored (selfie-view) canvas.
 */
export function renderCap(
  ctx: CanvasRenderingContext2D,
  face: FaceData,
  capImage: HTMLImageElement
): void {
  const { faceWidth, eyebrowY, faceCenterX, angleDeg } = face;

  // ── 1. Scale ─────────────────────────────────────────────────────────────
  // _scale(): target_w = face_width * 1.2, target_h = orig_h * target_w / orig_w
  const capW = Math.max(1, faceWidth * CAP_WIDTH_MULTIPLIER);
  const capH = Math.max(1, (capImage.naturalHeight / capImage.naturalWidth) * capW);

  // ── 2. Perspective warp approximation ────────────────────────────────────
  // _perspective_warp(): bottom corners rise by curve_px = int(capH * 0.06).
  // All 4 corners stay horizontally; only the bottom two Y values rise by curve_px.
  // → Bottom edge appears shorter than the actual capH by curve_px pixels.
  // We approximate this by reducing the drawn height at the bottom.
  const curvePx = Math.round(capH * BRIM_CURVE_RATIO); // ≈ 0.06 * capH

  // ── 3. Visual anchor (alpha bounding box) ────────────────────────────────
  // For removebg PNGs the visible area ≈ full image: anchor_y = capH, anchor_x = capW/2.
  // After the perspective warp, the bottom rises by curvePx on BOTH sides (symmetric),
  // so the effective bottom = capH - curvePx.
  const unrotatedAnchorY = capH - curvePx;  // y + border_h after warp
  const unrotatedAnchorX = capW / 2;         // x + border_w // 2

  // ── 4. Rotation + anchor transform ───────────────────────────────────────
  // Python: _rotate_bound(cap_s, -angleDeg) — in OpenCV positive angle is CCW,
  // so -angleDeg = clockwise rotation of the cap image, matching face tilt.
  // In canvas: ctx.rotate(angleRad) with positive angleDeg → clockwise — equivalent.
  const angleRad = (angleDeg * Math.PI) / 180;

  // Transform anchor point through rotation matrix (lines 175-187):
  // M = getRotationMatrix2D((capW/2, capH/2), -angleDeg, 1.0) with expanded canvas
  // After translation adjustment the anchor transforms as:
  const cX = capW / 2, cY = capH / 2;
  const cosA = Math.cos(-angleRad), sinA = Math.sin(-angleRad);
  // Expanded canvas size after rotate_bound:
  const nW = Math.abs(capH * Math.sin(angleRad)) + Math.abs(capW * Math.cos(angleRad));
  const nH = Math.abs(capH * Math.cos(angleRad)) + Math.abs(capW * Math.sin(angleRad));
  // Rotation matrix with translation to new center:
  const Mtx = [cosA, -sinA, (nW / 2) - cX + cosA * (-cX) + sinA * cY,
               sinA,  cosA, (nH / 2) - cY - sinA * (-cX) + cosA * (-cY)];
  // Transform: [anchorX, anchorY, 1] → M · [anchorX - 0, anchorY - 0, 1]
  // Standard 2D affine: new_x = cosA*(px - cX) - sinA*(py - cY) + nW/2
  //                     new_y = sinA*(px - cX) + cosA*(py - cY) + nH/2
  const ax = unrotatedAnchorX - cX, ay = unrotatedAnchorY - cY;
  const anchorX = cosA * ax + sinA * ay + nW / 2;
  const anchorY = -sinA * ax + cosA * ay + nH / 2;
  // Note: sinA uses -angleRad, so sin(-angleRad) for the rotation

  // ── 5. Place cap ─────────────────────────────────────────────────────────
  // cap_top  = brim_y - anchor_y  (line 201)
  // cap_left = face_center_x - anchor_x  (line 202)
  const capTop  = eyebrowY    - anchorY;
  const capLeft = faceCenterX - anchorX;

  // Draw: translate to cap_top/cap_left, apply rotation, draw image
  // The canvas ctx already has the mirror transform (translate(W,0)+scale(-1,1))
  // applied at the call site, so faceCenterX and eyebrowY are in landmark coords.
  ctx.save();
  // Pivot around the anchor point in screen space:
  ctx.translate(faceCenterX, eyebrowY);
  ctx.rotate(angleRad);  // clockwise for positive angleDeg = correct
  // Draw from top-left of the (rotated) cap:
  // offset = (-anchorX, -anchorY) from pivot
  ctx.drawImage(capImage, -anchorX, -anchorY, capW, capH - curvePx);
  ctx.restore();
}

// Re-export landmark arrays for use in App.tsx
export { LEFT_FACE_EDGE, RIGHT_FACE_EDGE, LEFT_EYEBROW_TOP, RIGHT_EYEBROW_TOP, FOREHEAD_TOP };
