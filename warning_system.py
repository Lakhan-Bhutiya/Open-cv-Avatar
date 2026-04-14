"""
warning_system.py
-----------------
Checks if there is enough frame space above the face to place the cap.

Statuses:
  OK      → cap fits fully, all good
  WARNING → cap partially clipped at top (>= min_coverage_pct visible)
  ERROR   → cap mostly out of frame, placement not meaningful
"""

from dataclasses import dataclass
from enum import Enum


class CapStatus(Enum):
    OK      = "ok"
    WARNING = "warning"
    ERROR   = "error"


# Colors (BGR) for status banner on image
STATUS_COLOR = {
    CapStatus.OK:      (34, 197, 94),    # green
    CapStatus.WARNING: (0, 165, 255),    # orange
    CapStatus.ERROR:   (0, 0, 220),      # red
}


@dataclass
class PlacementCheck:
    status:       CapStatus
    message:      str
    clip_top_px:  int    # pixels of cap hidden above frame top
    coverage_pct: float  # % of cap area that is visible


def check_placement(face_data: dict, cap_w: int, cap_h: int,
                    min_coverage_pct: float = 50.0) -> PlacementCheck:
    """
    Determine if the scaled cap fits above the face in the image frame.

    Parameters
    ----------
    face_data        : dict from FaceDetector.detect()
    cap_w, cap_h     : pixel size of the already-scaled cap
    min_coverage_pct : minimum visible % before ERROR is raised (default 50)
    """
    img_h, img_w  = face_data["image_shape"]
    eyebrow_y     = face_data["eyebrow_y"]
    face_center_x = face_data["face_center_x"]

    # Reject side profiles before checking coverage
    if face_data.get("is_profile", False):
        return PlacementCheck(
            status=CapStatus.ERROR,
            message=f"Strict profile mask detected (yaw ratio {face_data.get('yaw_ratio', 0):.2f}). Skipping.",
            clip_top_px=0,
            coverage_pct=0.0,
        )

    # Reject if forehead is covered (likely already wearing a cap)
    if face_data.get("is_forehead_covered", False):
        return PlacementCheck(
            status=CapStatus.ERROR,
            message="Forehead appears obstructed (already wearing a cap?). Skipping.",
            clip_top_px=0,
            coverage_pct=0.0,
        )

    cap_top_y   = eyebrow_y - cap_h
    cap_left_x  = face_center_x - cap_w // 2
    cap_right_x = cap_left_x + cap_w

    # Clipping on each side
    clip_top   = max(0, -cap_top_y)
    clip_left  = max(0, -cap_left_x)
    clip_right = max(0, cap_right_x - img_w)

    vis_h = max(0, cap_h - clip_top)
    vis_w = max(0, cap_w - clip_left - clip_right)
    coverage_pct = round((vis_h * vis_w) / (cap_h * cap_w) * 100, 1)

    if coverage_pct >= 95:
        return PlacementCheck(
            status=CapStatus.OK,
            message="Cap placed successfully.",
            clip_top_px=clip_top,
            coverage_pct=coverage_pct,
        )
    elif coverage_pct >= min_coverage_pct:
        return PlacementCheck(
            status=CapStatus.WARNING,
            message=(f"Warning: Only {coverage_pct:.0f}% of cap visible. "
                     "Try moving face lower in the photo."),
            clip_top_px=clip_top,
            coverage_pct=coverage_pct,
        )
    else:
        return PlacementCheck(
            status=CapStatus.ERROR,
            message=(f"Error: Only {coverage_pct:.0f}% of cap fits — not enough "
                     "forehead/frame space. Face is too close to the top edge."),
            clip_top_px=clip_top,
            coverage_pct=coverage_pct,
        )
