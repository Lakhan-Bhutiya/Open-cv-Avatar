"""
face_detector.py
----------------
Uses MediaPipe Face Mesh to detect face landmarks and extract:
  - Face bounding box
  - Face width (ear to ear)
  - Eyebrow Y position  → cap bottom sits here
  - Forehead height     → space available above eyebrows
  - Face center X       → for horizontal cap centering
"""

import cv2
import mediapipe as mp
import numpy as np
import os
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# --- MediaPipe landmark index groups ---
FOREHEAD_TOP_LANDMARKS = [10, 338, 297, 332, 284, 251, 389]
LEFT_EYEBROW_TOP       = [70, 63, 105, 66, 107]
RIGHT_EYEBROW_TOP      = [336, 296, 334, 293, 300]
LEFT_FACE_EDGE         = [234, 227, 116]
RIGHT_FACE_EDGE        = [454, 447, 345]
CHIN_BOTTOM            = [152, 175, 148]


class FaceDetector:
    def __init__(self, static_image_mode=True, max_faces=10, confidence=0.5):
        # Initialize the modern FaceLandmarker Tasks API
        # Model downloaded to face_landmarker.task in the root
        model_path = os.path.join(os.path.dirname(__file__), "face_landmarker.task")
        
        base_options = python.BaseOptions(model_asset_path=model_path)
        options = vision.FaceLandmarkerOptions(
            base_options=base_options,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
            num_faces=max_faces,
            min_face_detection_confidence=confidence,
            min_face_presence_confidence=confidence,
            running_mode=vision.RunningMode.IMAGE if static_image_mode else vision.RunningMode.VIDEO
        )
        self.detector = vision.FaceLandmarker.create_from_options(options)
        self.static_image_mode = static_image_mode

    def detect(self, image_bgr):
        """
        Detect faces and return list of face_data dicts.
        Returns [] if no face found.
        """
        h, w = image_bgr.shape[:2]
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB))
        
        if self.static_image_mode:
            results = self.detector.detect(mp_image)
        else:
            # For video mode, we need a timestamp in milliseconds
            import time
            timestamp_ms = int(time.time() * 1000)
            results = self.detector.detect_for_video(mp_image, timestamp_ms)

        faces = []
        if not results.face_landmarks:
            return faces

        for face_landmarks in results.face_landmarks:
            lm = face_landmarks

            def avg_pt(indices):
                return (np.mean([lm[i].x * w for i in indices]),
                        np.mean([lm[i].y * h for i in indices]))

            left_x  = min(lm[i].x * w for i in LEFT_FACE_EDGE)
            right_x = max(lm[i].x * w for i in RIGHT_FACE_EDGE)
            top_y   = min(lm[i].y * h for i in FOREHEAD_TOP_LANDMARKS)
            bot_y   = max(lm[i].y * h for i in CHIN_BOTTOM)

            left_brow_pt = avg_pt(LEFT_EYEBROW_TOP)
            right_brow_pt = avg_pt(RIGHT_EYEBROW_TOP)
            
            # Sort points by x-coordinate to ensure dx is always positive
            if left_brow_pt[0] < right_brow_pt[0]:
                pt1, pt2 = left_brow_pt, right_brow_pt
            else:
                pt1, pt2 = right_brow_pt, left_brow_pt
                
            # angle calculation for rotation
            dx = pt2[0] - pt1[0]
            dy = pt2[1] - pt1[1]
            import math
            angle_deg = math.degrees(math.atan2(dy, dx))

            face_width      = int(right_x - left_x)
            face_height     = int(bot_y - top_y)
            eyebrow_y       = int(np.mean([left_brow_pt[1], right_brow_pt[1]]))
            face_top_y      = int(top_y)
            forehead_height = eyebrow_y - face_top_y

            # Use the centroid of the eyebrows as the true "front" of the face
            # This handles head yaw (turning left/right) much better than bounding box limits
            face_center_x   = int((left_brow_pt[0] + right_brow_pt[0]) / 2)

            # Profile detection (Yaw)
            nose_x = lm[1].x * w
            left_dist = max(1.0, nose_x - left_x)
            right_dist = max(1.0, right_x - nose_x)
            yaw_ratio = min(left_dist, right_dist) / max(left_dist, right_dist)
            # If yaw_ratio is very low, one side of the face is barely visible in 2D (strict profile)
            is_profile = yaw_ratio < 0.20

            # -------------------------------------------------------------
            # Detect if forehead is covered (e.g. wearing a cap already)
            # -------------------------------------------------------------
            try:
                def get_patch_hsv(idx, size=5):
                    cx = int(lm[idx].x * w)
                    cy = int(lm[idx].y * h)
                    cx = max(size//2, min(w - size//2 - 1, cx))
                    cy = max(size//2, min(h - size//2 - 1, cy))
                    half = size // 2
                    patch = cv2.cvtColor(image_bgr[cy-half:cy+half+1, cx-half:cx+half+1], cv2.COLOR_BGR2HSV)
                    return np.median(patch, axis=(0,1))

                ref_hsv = np.median([get_patch_hsv(4), get_patch_hsv(50), get_patch_hsv(280)], axis=0)
                fh_hsv  = np.median([get_patch_hsv(10), get_patch_hsv(151), get_patch_hsv(9)], axis=0)
                diff = np.abs(ref_hsv - fh_hsv)
                # Heuristic thresholds: Hue diff > 25, Saturation > 55, Value > 70
                is_forehead_covered = bool(diff[0] > 25 or diff[1] > 55 or diff[2] > 70)
            except Exception:
                is_forehead_covered = False

            faces.append({
                "bbox":            (int(left_x), face_top_y, face_width, face_height),
                "face_width":      face_width,
                "face_height":     face_height,
                "face_top_y":      face_top_y,
                "eyebrow_y":       eyebrow_y,
                "forehead_height": forehead_height,
                "face_center_x":   face_center_x,
                "angle":           angle_deg,
                "is_profile":      is_profile,
                "is_forehead_covered": is_forehead_covered,
                "yaw_ratio":       yaw_ratio,
                "image_shape":     (h, w),
            })

        return faces

    def draw_debug(self, image, face_data):
        """Overlay debug lines: bounding box, eyebrow line, forehead zone."""
        x, y, w, h = face_data["bbox"]
        ey = face_data["eyebrow_y"]
        cv2.rectangle(image, (x, y), (x + w, y + h), (0, 255, 0), 2)
        cv2.line(image, (x, ey), (x + w, ey), (255, 80, 0), 2)
        cv2.rectangle(image, (x, y), (x + w, ey), (0, 220, 220), 1)
        cv2.putText(image, f"W:{face_data['face_width']}px", (x, y - 28),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 2)
        cv2.putText(image, f"Forehead:{face_data['forehead_height']}px", (x, y - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 220, 220), 2)
        return image

    def close(self):
        self.detector.close()
