/**
 * checkPlacement.ts
 * =================
 * Faithful TypeScript port of warning_system.py.
 * check_placement() function — unchanged from original.
 */

import { FaceData } from './capRenderer';

export type CapStatus = 'ok' | 'warning' | 'error';

export interface PlacementCheck {
  status:      CapStatus;
  message:     string;
  coveragePct: number;
}

/**
 * Determine if the scaled cap fits above the face in the image frame.
 * Exact port of warning_system.py:check_placement() (lines 38-106).
 *
 * @param face      FaceData from extractFaceData()
 * @param capW      width of the already-scaled cap  (face_width * 1.2)
 * @param capH      height of the already-scaled cap
 * @param minCovPct minimum visible % before ERROR (default 50)
 */
export function checkPlacement(
  face: FaceData,
  capW: number,
  capH: number,
  minCovPct = 50
): PlacementCheck {
  // lines 54-60: reject strict profiles
  if (face.isProfile) {
    return {
      status: 'error',
      message: `Strict profile detected (yaw ratio ${face.yawRatio.toFixed(2)}). Skipping.`,
      coveragePct: 0,
    };
  }

  // lines 62-69: reject if forehead is covered
  if (face.isForeheadCovered) {
    return {
      status: 'error',
      message: 'Forehead appears obstructed (already wearing a cap?). Skipping.',
      coveragePct: 0,
    };
  }

  // lines 71-82: coverage calculation
  const capTopY   = face.eyebrowY - capH;
  const capLeftX  = face.faceCenterX - capW / 2;
  const capRightX = capLeftX + capW;

  const clipTop   = Math.max(0, -capTopY);
  const clipLeft  = Math.max(0, -capLeftX);
  const clipRight = Math.max(0, capRightX - face.imageW);

  const visH = Math.max(0, capH - clipTop);
  const visW = Math.max(0, capW - clipLeft - clipRight);
  const coveragePct = Math.round(visH * visW / (capH * capW) * 1000) / 10;

  // lines 84-106: status thresholds
  if (coveragePct >= 95) {
    return { status: 'ok', message: 'Cap placed successfully.', coveragePct };
  } else if (coveragePct >= minCovPct) {
    return {
      status: 'warning',
      message: `Warning: Only ${coveragePct.toFixed(0)}% of cap visible. Try moving face lower.`,
      coveragePct,
    };
  } else {
    return {
      status: 'error',
      message: `Error: Only ${coveragePct.toFixed(0)}% of cap fits — move head down.`,
      coveragePct,
    };
  }
}
