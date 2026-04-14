import argparse
import asyncio
import json
import logging
import os
import time
import cv2
import numpy as np

from aiohttp import web
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack, RTCIceServer, RTCConfiguration
from aiortc.contrib.media import MediaRelay
from av import VideoFrame

# Import your existing Python logic!
from face_detector import FaceDetector
from cap_overlay import CapOverlay
from warning_system import check_placement, CapStatus

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler("webrtc.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("pc")

relay = MediaRelay()

# Initialize our AI models globally so we don't reload them
face_detector = FaceDetector(static_image_mode=False)

# Get all cap images in the assets folder
CAPS_DIR = os.path.join("web-app", "public", "assets", "caps")
cap_paths = [os.path.join(CAPS_DIR, f) for f in os.listdir(CAPS_DIR) 
             if f.lower().endswith((".png", ".jpg", ".jpeg"))]
cap_paths.sort() # Ensure consistent ordering
if not cap_paths:
    # fallback
    cap_paths = ["assets/caps/image.png"] # Example path, ideally it exists
cap_overlay = CapOverlay(cap_paths)

class CapVideoTrack(VideoStreamTrack):
    """
    A video stream track that transforms frames from an another track.
    Uses a single-slot queue (maxsize=1) so the server always processes the
    LATEST frame, dropping stale ones. This eliminates queue-buildup lag.
    """

    def __init__(self, track):
        super().__init__()  # don't forget this!
        self.track = track
        self.cap_index = 0
        self.channel = None
        self.debug_mode = False
        # Single-slot queue: putting a new frame when full drops the old one
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        self._frames_dropped = 0
        # Start background task that drains incoming frames into the queue
        asyncio.ensure_future(self._drain_track())

    async def _drain_track(self):
        """Continuously pull frames from the source track and keep only the newest."""
        while True:
            try:
                frame = await self.track.recv()
                if self._queue.full():
                    # Drop the stale queued frame – we replace it with the fresh one
                    try:
                        self._queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                    self._frames_dropped += 1
                    if self._frames_dropped % 30 == 0:
                        logger.info(f"[FrameDrop] {self._frames_dropped} frames dropped so far – server is behind.")
                await self._queue.put(frame)
            except Exception as e:
                logger.error(f"_drain_track error: {e}")
                break

    def transform(self, img, cap_index):
        h, w = img.shape[:2]
        # 1. Detect faces
        faces = face_detector.detect(img)
        
        # 2. Process faces and apply caps
        main_suggestion = "No face detected"
        main_cap_status = CapStatus.ERROR
        
        if faces:
            # We determine the status banner based on the "main" face (the first one)
            first_face = faces[0]
            cap_w, cap_h = cap_overlay.get_scaled_size(first_face, cap_index=cap_index)
            check = check_placement(first_face, cap_w, cap_h)
            main_cap_status = check.status
            
            if first_face.get("is_profile", False):
                main_suggestion = "Look straight at the camera!"
            elif first_face.get("is_forehead_covered", False):
                main_suggestion = "Remove your hat / Clear your forehead!"
            elif main_cap_status == CapStatus.ERROR:
                main_suggestion = "Move your head DOWN! Not enough space above you."
            elif main_cap_status == CapStatus.WARNING:
                main_suggestion = f"Move your head slightly lower. ({check.coverage_pct}% visible)"
            else:
                main_suggestion = "Perfect! Keep it there."

            # Loop through ALL faces and apply the cap to each
            for face in faces:
                # Re-calculate size and placement check for THIS individual face
                this_cap_w, this_cap_h = cap_overlay.get_scaled_size(face, cap_index=cap_index)
                this_check = check_placement(face, this_cap_w, this_cap_h)
                
                # Only apply if it doesn't cause a fatal error (e.g. off screen top)
                if this_check.status != CapStatus.ERROR:
                    img, _, _ = cap_overlay.apply(img, face, cap_index=cap_index)

            # Draw debug lines if enabled
            if self.debug_mode:
                for face in faces:
                    img = face_detector.draw_debug(img, face)

        # Send status to frontend via DataChannel
        if hasattr(self, "channel") and self.channel and self.channel.readyState == "open":
            try:
                self.channel.send(json.dumps({
                    "type": "status",
                    "status": main_cap_status.value,
                    "message": main_suggestion
                }))
            except Exception as e:
                logger.error(f"Error sending status: {e}")

        return img

    async def recv(self):
        # Block here until a fresh frame is available in our single-slot queue.
        # The _drain_track background task keeps this queue populated with the
        # LATEST frame, so we never build up a backlog.
        frame = await self._queue.get()

        # Convert to numpy array (BGR from OpenCV)
        img = frame.to_ndarray(format="bgr24")

        # Mirror the video for the classic "selfie" view immediately.
        img = cv2.flip(img, 1)

        # Offload CPU-intensive work to a thread so we don't block the event loop
        t0 = time.perf_counter()
        loop = asyncio.get_event_loop()
        img = await loop.run_in_executor(None, self.transform, img, self.cap_index)
        elapsed_ms = (time.perf_counter() - t0) * 1000
        if elapsed_ms > 200:
            logger.warning(f"[Slow] Frame processing took {elapsed_ms:.0f}ms")

        # 4. Re-pack frame to send back to browser
        new_frame = VideoFrame.from_ndarray(img, format="bgr24")
        new_frame.pts = frame.pts
        new_frame.time_base = frame.time_base
        return new_frame

async def offer(request):
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])

    # Configure STUN for NAT traversal
    ice_servers = [RTCIceServer(urls="stun:stun.l.google.com:19302")]
    config = RTCConfiguration(iceServers=ice_servers)
    pc = RTCPeerConnection(configuration=config)
    pc_id = "PeerConnection(%s)" % id(pc)
    logger.info("Created for %s", request.remote)

    # Optional: support changing caps via datachannel? For now we can just hardcode or implement later

    @pc.on("datachannel")
    def on_datachannel(channel):
        logger.info("Data channel '%s' established", channel.label)
        
        # Link channel to video track if it exists
        if hasattr(pc, "custom_video_track"):
            pc.custom_video_track.channel = channel
        else:
            pc.pending_channel = channel

        @channel.on("message")
        def on_message(message):
            if isinstance(message, str):
                try:
                    data = json.loads(message)
                    if data.get("type") == "change_cap":
                        new_index = data.get("cap_index", 0)
                        logger.info(f"Received change_cap request for index {new_index}")
                        
                        pc.pending_cap_index = new_index
                        
                        # Set directly if we stored it
                        if hasattr(pc, "custom_video_track"):
                            pc.custom_video_track.cap_index = new_index
                            logger.info("Updated custom_video_track successfully.")
                    
                    elif data.get("type") == "toggle_debug":
                        if hasattr(pc, "custom_video_track"):
                            pc.custom_video_track.debug_mode = not pc.custom_video_track.debug_mode
                            logger.info(f"Debug mode toggled to {pc.custom_video_track.debug_mode}")
                except Exception as e:
                    logger.error(f"Error parsing datachannel message: {e}")

    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        logger.info("Connection state is %s", pc.connectionState)
        if pc.connectionState == "failed":
            await pc.close()

    @pc.on("track")
    def on_track(track):
        logger.info("Track %s received", track.kind)

        if track.kind == "video":
            # Add our processing track
            local_video = CapVideoTrack(relay.subscribe(track))
            
            # Apply any buffered cap index if it was sent rapidly before track allocation
            if hasattr(pc, "pending_cap_index"):
                local_video.cap_index = pc.pending_cap_index
                logger.info(f"Applied buffered cap_index {pc.pending_cap_index} on fresh video track")
                
            pc.addTrack(local_video)
            pc.custom_video_track = local_video
            
            # Link already established channel
            if hasattr(pc, "pending_channel"):
                local_video.channel = pc.pending_channel
                logger.info("Linked pending data channel to video track")

        @track.on("ended")
        async def on_ended():
            logger.info("Track %s ended", track.kind)

    # Handle offer
    await pc.setRemoteDescription(offer)
    
    # Send answer
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    return web.Response(
        content_type="application/json",
        text=json.dumps(
            {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}
        ),
    )


async def on_shutdown(app):
    # Close all peer connections
    coros = [pc.close() for pc in set()]
    await asyncio.gather(*coros)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="WebRTC Cap Try-On Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host for HTTP server (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=5025, help="Port for HTTP server (default: 5025)")
    args = parser.parse_args()

    # CORS configuration so the Vite app (port 3000) can hit this server
    app = web.Application()
    app.on_shutdown.append(on_shutdown)
    
    import aiohttp_cors
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
                allow_credentials=True,
                expose_headers="*",
                allow_headers="*",
            )
    })

    # Add routes
    resource = cors.add(app.router.add_resource("/offer"))
    cors.add(resource.add_route("POST", offer))


    web.run_app(app, host=args.host, port=args.port)
