import sys
import cap_overlay
import face_detector
import cv2

fd = face_detector.FaceDetector()
img = cv2.imread("Assets/test_images/20260406_174157.jpg")
face_data_list = fd.detect(img)
if not face_data_list:
    print("No faces found")
    sys.exit(1)

face_data = face_data_list[0]
print(f"Face data: eyebrow_y={face_data['eyebrow_y']}, forehead_h={face_data['forehead_height']}, face_top_y={face_data['face_top_y']}")

co = cap_overlay.CapOverlay(["Assets/caps/istockphoto-1157599346-612x612-removebg-preview.png"]) # Let's use one of the caps
cap_rgba = co._load(co.cap_paths[0])
cap_s = co._scale(cap_rgba, face_data["face_width"])
print(f"Cap path: {co.cap_paths[0]}")
print(f"Initial scaled cap shape: {cap_s.shape}")

cap_s = co._perspective_warp(cap_s, cap_overlay.BRIM_CURVE_RATIO)
angle = face_data.get("angle", 0)
if angle != 0:
    cap_s = co._rotate_bound(cap_s, -angle)

h, w = cap_s.shape[:2]
alpha_channel = cap_s[:, :, 3]
coords = cv2.findNonZero(alpha_channel)
x, y, border_w, border_h = cv2.boundingRect(coords)
visual_cap_bottom = y + border_h

print(f"After transformations: padding box shape={cap_s.shape}, visual_cap_bottom={visual_cap_bottom}, border_h={border_h}, y={y}")

brim_y = face_data["eyebrow_y"] + int(face_data["forehead_height"] * cap_overlay.CAP_BRIM_BELOW_EYEBROW)
cap_top = brim_y - visual_cap_bottom
print(f"brim_y={brim_y}, cap_top={cap_top}")