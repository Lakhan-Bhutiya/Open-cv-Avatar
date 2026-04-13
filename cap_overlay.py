"""
cap_overlay.py
--------------
Loads cap PNG images (RGBA), scales them to match face width,
and overlays them on the face image using alpha blending.
Applies rotation (face tilt) and perspective warp (brim curve) for realism.
"""

import cv2
import numpy as np


# Cap width relative to face width. 1.2 = 20% wider than face (natural look)
CAP_WIDTH_MULTIPLIER = 1.2

# How far the brim bottom sits below the top of the forehead (fraction of forehead height)
# A cap naturally rests so its brim is on the mid-to-lower forehead
CAP_BRIM_BELOW_TOP = 0.70

# How much the brim curves upward at the center as a fraction of cap height
BRIM_CURVE_RATIO = 0.06


class CapOverlay:
    def __init__(self, cap_paths: list):
        """
        Parameters
        ----------
        cap_paths : list of str — file paths to cap PNG images (RGBA preferred)
        """
        if not cap_paths:
            raise ValueError("At least one cap path must be provided.")
        self.cap_paths = cap_paths
        self._cache: dict = {}

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load(self, path: str) -> np.ndarray:
        """Load and cache cap as RGBA (H x W x 4)."""
        if path not in self._cache:
            img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
            if img is None:
                raise FileNotFoundError(f"Cap image not found: {path}")
            if img.ndim == 2:                       # grayscale
                img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGRA)
            elif img.shape[2] == 3:                 # BGR, no alpha
                alpha = np.full((*img.shape[:2], 1), 255, dtype=np.uint8)
                img = np.concatenate([img, alpha], axis=2)

            # Crop transparent margins based on alpha channel
            alpha_channel = img[:, :, 3]
            _, alpha_thresh = cv2.threshold(alpha_channel, 20, 255, cv2.THRESH_BINARY)
            coords = cv2.findNonZero(alpha_thresh)
            if coords is not None:
                x, y, w, h = cv2.boundingRect(coords)
                img = img[y:y+h, x:x+w]

            self._cache[path] = img
        return self._cache[path]

    def _scale(self, cap_rgba: np.ndarray, face_width: int, multiplier: float) -> np.ndarray:
        """Scale cap width to face_width * multiplier (keep aspect ratio)."""
        orig_h, orig_w = cap_rgba.shape[:2]
        target_w = max(1, int(face_width * multiplier))
        target_h = max(1, int(orig_h * target_w / orig_w))
        return cv2.resize(cap_rgba, (target_w, target_h),
                          interpolation=cv2.INTER_LANCZOS4)

    def _rotate_bound(self, image: np.ndarray, angle: float) -> np.ndarray:
        """Rotate image while expanding the bounding box to avoid clipping."""
        (h, w) = image.shape[:2]
        (cX, cY) = (w // 2, h // 2)

        M = cv2.getRotationMatrix2D((cX, cY), angle, 1.0)
        cos = np.abs(M[0, 0])
        sin = np.abs(M[0, 1])

        nW = int((h * sin) + (w * cos))
        nH = int((h * cos) + (w * sin))

        M[0, 2] += (nW / 2) - cX
        M[1, 2] += (nH / 2) - cY

        return cv2.warpAffine(image, M, (nW, nH), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

    def _perspective_warp(self, image: np.ndarray, curve_ratio: float) -> np.ndarray:
        """
        Apply a subtle trapezoid warp to simulate the cap brim curving with the head.
        The bottom edge bows upward slightly in the center, as a real brim looks in perspective.
        curve_ratio: how much the bottom center rises as a fraction of image height.
        """
        h, w = image.shape[:2]
        curve_px = int(h * curve_ratio)

        # Source corners (flat rectangle)
        src = np.float32([
            [0,     0],    # top-left
            [w,     0],    # top-right
            [w,     h],    # bottom-right
            [0,     h],    # bottom-left
        ])

        # Destination: bottom edge bows upward in the center (trapezoid-like)
        # Left and right bottom corners stay at h; centre bows up by curve_px
        dst = np.float32([
            [0,     0],             # top-left stays
            [w,     0],             # top-right stays
            [w,     h - curve_px],  # bottom-right rises slightly
            [0,     h - curve_px],  # bottom-left rises slightly (symmetric)
        ])

        M = cv2.getPerspectiveTransform(src, dst)
        return cv2.warpPerspective(image, M, (w, h), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    # Custom override multipliers for specific cap indices
    CAP_MULTIPLIERS = {
        0: 1.8,  # Black wide brim hat
        6: 1.8,  # Black top hat
        7: 1.3,  # Brown flat cap
        8: 2.1,  # Cowboy hat
    }

    def get_scaled_size(self, face_data: dict, cap_index: int = 0) -> tuple:
        """Return (width, height) of the scaled cap without drawing anything."""
        idx = cap_index % len(self.cap_paths)
        multiplier = self.CAP_MULTIPLIERS.get(idx, CAP_WIDTH_MULTIPLIER)
        cap_rgba  = self._load(self.cap_paths[idx])
        scaled    = self._scale(cap_rgba, face_data["face_width"], multiplier)
        return scaled.shape[1], scaled.shape[0]

    def apply(self, base_bgr: np.ndarray, face_data: dict,
              cap_index: int = 0) -> tuple:
        """
        Place cap on the face in base_bgr.

        Alignment strategy:
          - The cap brim bottom aligns just below the hairline (face_top_y + small offset)
          - Rotation matches face tilt angle
          - Perspective warp curves the brim to match head curvature

        Parameters
        ----------
        base_bgr  : original image, BGR (H x W x 3)
        face_data : dict from FaceDetector.detect()
        cap_index : which cap to use (0 / 1 / 2)

        Returns
        -------
        (result_bgr, cap_w, cap_h)
        """
        idx = cap_index % len(self.cap_paths)
        multiplier = self.CAP_MULTIPLIERS.get(idx, CAP_WIDTH_MULTIPLIER)
        path      = self.cap_paths[idx]
        cap_rgba  = self._load(path)
        cap_s     = self._scale(cap_rgba, face_data["face_width"], multiplier)

        # Apply perspective warp to curve the brim
        cap_s = self._perspective_warp(cap_s, BRIM_CURVE_RATIO)

        # 1. Find visual bounding box of the unrotated cap
        cap_h, cap_w = cap_s.shape[:2]
        alpha_channel = cap_s[:, :, 3]
        _, alpha_thresh = cv2.threshold(alpha_channel, 20, 255, cv2.THRESH_BINARY)
        coords = cv2.findNonZero(alpha_thresh)
        if coords is not None:
            x, y, border_w, border_h = cv2.boundingRect(coords)
            unrotated_anchor_y = y + border_h
            unrotated_anchor_x = x + border_w // 2
        else:
            unrotated_anchor_y = cap_h
            unrotated_anchor_x = cap_w // 2

        # 2. Apply rotation based on face tilt and transform the anchor point
        angle = face_data.get("angle", 0)
        if angle != 0:
            # Rotate cap image
            cap_s = self._rotate_bound(cap_s, -angle)
            rotated_h, rotated_w = cap_s.shape[:2]

            # Transform anchor point
            cX, cY = cap_w // 2, cap_h // 2
            M = cv2.getRotationMatrix2D((cX, cY), -angle, 1.0)
            cos = np.abs(M[0, 0])
            sin = np.abs(M[0, 1])
            nW = int((cap_h * sin) + (cap_w * cos))
            nH = int((cap_h * cos) + (cap_w * sin))
            M[0, 2] += (nW / 2) - cX
            M[1, 2] += (nH / 2) - cY

            anchor_pt = np.array([unrotated_anchor_x, unrotated_anchor_y, 1.0])
            transformed_anchor = M.dot(anchor_pt)
            anchor_x = int(transformed_anchor[0])
            anchor_y = int(transformed_anchor[1])
            
            cap_h, cap_w = rotated_h, rotated_w
        else:
            anchor_x = unrotated_anchor_x
            anchor_y = unrotated_anchor_y

        img_h, img_w  = base_bgr.shape[:2]

        # The brim bottom sits on the eyebrows as requested
        brim_y = face_data["eyebrow_y"]
        face_center_x = face_data["face_center_x"]

        # Cap top is aligned so that the transformed anchor maps to `brim_y` and `face_center_x`
        cap_top    = brim_y - anchor_y
        cap_left   = face_center_x - anchor_x
        
        # The true image endpoints (including transparent padding)
        cap_bottom = cap_top + cap_h
        cap_right  = cap_left + cap_w

        # Source crop (inside the cap image)
        src_y1 = max(0, -cap_top)
        src_x1 = max(0, -cap_left)
        src_y2 = cap_h - max(0, cap_bottom - img_h)
        src_x2 = cap_w - max(0, cap_right  - img_w)

        # Destination crop (inside the base image)
        dst_y1 = max(0, cap_top)
        dst_x1 = max(0, cap_left)
        dst_y2 = dst_y1 + (src_y2 - src_y1)
        dst_x2 = dst_x1 + (src_x2 - src_x1)

        result = base_bgr.copy()

        if src_y2 <= src_y1 or src_x2 <= src_x1:
            return result, cap_w, cap_h   # nothing to draw

        cap_crop  = cap_s[src_y1:src_y2, src_x1:src_x2]
        base_crop = result[dst_y1:dst_y2, dst_x1:dst_x2].astype(np.float32)

        alpha = cap_crop[:, :, 3:4].astype(np.float32) / 255.0
        fore  = cap_crop[:, :, :3].astype(np.float32)

        blended = fore * alpha + base_crop * (1.0 - alpha)
        result[dst_y1:dst_y2, dst_x1:dst_x2] = blended.astype(np.uint8)

        return result, cap_w, cap_h
