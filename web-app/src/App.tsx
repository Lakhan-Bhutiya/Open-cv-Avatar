/**
 * App.tsx
 * =======
 * Faithful TypeScript port of webcam_guide.py + main.py.
 *
 * Main loop mirrors webcam_guide.py:main() while loop:
 *  - Detects face, extracts metrics (face_detector.py)
 *  - Checks cap placement (warning_system.py)
 *  - Applies cap only when status != ERROR (webcam_guide.py lines 92-113)
 *  - Posture guidance messages with exact text from webcam_guide.py
 *  - SPACE / Capture button to save with status banner (main.py:draw_status_banner)
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFaceMesh } from './hooks/useFaceMesh';
import {
  extractFaceData,
  detectForeheadCovered,
  renderCap,
  FaceData,
  CAP_WIDTH_MULTIPLIER,
} from './utils/capRenderer';
import { checkPlacement, CapStatus, PlacementCheck } from './utils/checkPlacement';

// ── Cap assets ────────────────────────────────────────────────────────────────
const CAPS = [
  { id: 1, path: '/assets/caps/image.png' },
  { id: 2, path: '/assets/caps/image_copy-removebg-preview.png' },
  { id: 3, path: '/assets/caps/image_copy_2-removebg-preview (1).png' },
  { id: 4, path: '/assets/caps/images-removebg-preview.png' },
  { id: 5, path: '/assets/caps/istockphoto-1157599346-612x612-removebg-preview.png' },
];

// ── Status colors (mirrors STATUS_COLOR in warning_system.py) ─────────────────
const STATUS_STYLE: Record<CapStatus, { color: string; bg: string; border: string }> = {
  ok:      { color: '#4ade80', bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.4)' },
  warning: { color: '#fb923c', bg: 'rgba(251,146,60,0.15)', border: 'rgba(251,146,60,0.4)' },
  error:   { color: '#f87171', bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.4)' },
};

function App() {
  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  // Off-screen canvas for pixel sampling — willReadFrequently for perf
  const sampleRef    = useRef<HTMLCanvasElement | null>(null);

  const [selectedCap, setSelectedCap] = useState(CAPS[0]);
  const [capImage,    setCapImage]    = useState<HTMLImageElement | null>(null);
  const [suggestion,  setSuggestion]  = useState('Initializing...');
  const [capStatus,   setCapStatus]   = useState<CapStatus>('error');
  const [canCapture,  setCanCapture]  = useState(false);
  const [captured,    setCaptured]    = useState(false);

  // Keep latest face+check for capture
  const latestFace  = useRef<FaceData | null>(null);
  const latestCheck = useRef<PlacementCheck | null>(null);

  const { results, isConnected } = useFaceMesh(videoRef.current);

  // Initialize off-screen canvas with willReadFrequently
  useEffect(() => {
    const c = document.createElement('canvas');
    sampleRef.current = c;
  }, []);

  // Load cap image whenever selection changes
  useEffect(() => {
    const img = new Image();
    img.src = selectedCap.path;
    img.onload = () => setCapImage(img);
    setCaptured(false);
  }, [selectedCap]);

  // ── Main render loop — mirrors webcam_guide.py while-loop ──────────────────
  useEffect(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    const sample = sampleRef.current;
    if (!results || !canvas || !video || !capImage || !sample) return;

    const W = video.videoWidth  || 640;
    const H = video.videoHeight || 480;

    canvas.width  = W;
    canvas.height = H;
    sample.width  = W;
    sample.height = H;

    const ctx  = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    // ── No face detected (webcam_guide.py line 74) ───────────────────────────
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
      setSuggestion('No face detected');
      setCapStatus('error');
      setCanCapture(false);
      latestFace.current  = null;
      latestCheck.current = null;
      return;
    }

    const landmarks = results.multiFaceLandmarks[0];

    // ── Extract face metrics (face_detector.py:detect) ───────────────────────
    const face = extractFaceData(landmarks, W, H);

    // ── Forehead covered detection (face_detector.py lines 98-114) ───────────
    // Sample the raw (unmirrored) video frame
    const sCtx = sample.getContext('2d', { willReadFrequently: true })!;
    sCtx.drawImage(video, 0, 0, W, H);
    const { data } = sCtx.getImageData(0, 0, W, H);
    face.isForeheadCovered = detectForeheadCovered(data, landmarks, W, H);

    // ── Cap dimensions (webcam_guide.py line 87-88) ───────────────────────────
    const capW = face.faceWidth * CAP_WIDTH_MULTIPLIER;
    const capH = capW * (capImage.naturalHeight / capImage.naturalWidth);

    // ── Placement check (warning_system.py:check_placement) ──────────────────
    const check = checkPlacement(face, capW, capH);
    setCapStatus(check.status);
    setCanCapture(check.status !== 'error');
    latestFace.current  = face;
    latestCheck.current = check;

    // ── Posture guidance (webcam_guide.py lines 92-113 if/elif chain) ─────────
    if (!isConnected) {
      setSuggestion('Connecting camera...');
    } else if (face.isProfile) {
      setSuggestion('Look straight at the camera!');         // line 94
    } else if (face.isForeheadCovered) {
      setSuggestion('Remove your hat / Clear your forehead!'); // line 97
    } else if (check.status === 'error') {
      setSuggestion('Move your head DOWN! Not enough space above you.'); // line 100
    } else if (check.status === 'warning') {
      setSuggestion(`Move your head slightly lower. (${check.coveragePct.toFixed(0)}% visible)`); // line 108
    } else {
      setSuggestion('Perfect! Press SPACE to capture.');     // line 111
    }

    // ── Apply cap only when status != error (webcam_guide.py lines 103-104) ──
    if (check.status !== 'error') {
      // Mirror the canvas ctx to match the CSS-mirrored video element
      // (landmarks are in unmirrored camera space; video is CSS scaleX(-1))
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      renderCap(ctx, face, capImage);
      ctx.restore();
    }
  }, [results, capImage, isConnected]);

  // ── Capture: mirrors webcam_guide.py lines 126-141 ─────────────────────────
  const handleCapture = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    const face   = latestFace.current;
    const check  = latestCheck.current;
    if (!video || !canvas || !face || !check || !canCapture) return;

    const W = video.videoWidth;
    const H = video.videoHeight;
    const out = document.createElement('canvas');
    out.width  = W;
    out.height = H;
    const ctx = out.getContext('2d')!;

    // Draw mirrored video frame (selfie view)
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Composite the cap overlay (already in screen/mirrored orientation)
    ctx.drawImage(canvas, 0, 0);

    // ── Status banner (main.py:draw_status_banner lines 33-60) ──────────────
    const style     = STATUS_STYLE[check.status];
    const scale     = Math.max(1.0, H / 800);
    const barH      = Math.round(48 * scale);
    const fontScale = 0.58 * scale;

    // Semi-transparent bar
    ctx.globalAlpha = 0.55;
    ctx.fillStyle   = style.bg.replace('0.15', '1'); // solid for the bar
    ctx.fillRect(0, H - barH, W, barH);
    ctx.globalAlpha = 1;

    // Icon + text (main.py line 47-51)
    const icon    = check.status === 'ok' ? '[OK]' : check.status === 'warning' ? '[WARN]' : '[ERR]';
    const msg     = `${icon}  ${check.message}  |  Coverage: ${check.coveragePct.toFixed(0)}%`;
    const yOffset = H - Math.round(14 * scale);
    ctx.fillStyle = '#ffffff';
    ctx.font      = `bold ${Math.round(14 * fontScale)}px Outfit, Inter, sans-serif`;
    ctx.fillText(msg, 12, yOffset);

    // Download
    const link      = document.createElement('a');
    link.download   = `cap_try_on_cap${selectedCap.id}.jpg`;
    link.href       = out.toDataURL('image/jpeg', 0.92);
    link.click();
    setCaptured(true);
  }, [canCapture, selectedCap]);

  const ss = STATUS_STYLE[capStatus];

  return (
    <div className="app-container">
      <header className="header">
        <h1>Cap Try-On</h1>
        <p>Real-time Virtual Face Projection</p>
      </header>

      <div className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
        <div className="pulse" />
        {isConnected ? 'Camera Active' : 'Connecting...'}
      </div>

      <div className="video-container glass-panel">
        <video ref={videoRef} className="input_video" playsInline muted />
        <canvas ref={canvasRef} className="output_canvas" />

        {/* Posture guide HUD — mirrors the black bar from webcam_guide.py line 116-117 */}
        <div className="posture-hud" style={{
          background: ss.bg,
          border: `1px solid ${ss.border}`,
          color: ss.color,
        }}>
          <span className="posture-icon">
            {capStatus === 'ok' ? '✓' : capStatus === 'warning' ? '⚠' : '✗'}
          </span>
          <span className="posture-text">{suggestion}</span>
        </div>
      </div>

      {/* Cap selector + Capture button */}
      <div className="controls glass-panel">
        {CAPS.map(cap => (
          <button
            key={cap.id}
            id={`cap-btn-${cap.id}`}
            className={`cap-btn ${selectedCap.id === cap.id ? 'active' : ''}`}
            onClick={() => setSelectedCap(cap)}
          >
            <img src={cap.path} alt={`Cap ${cap.id}`} />
          </button>
        ))}

        <div className="divider" />

        <button
          id="capture-btn"
          className={`capture-btn ${canCapture ? 'ready' : 'disabled'}`}
          onClick={handleCapture}
          disabled={!canCapture}
          title={canCapture ? 'Capture (SPACE)' : 'Follow posture guide first'}
        >
          {captured ? '✓ Saved!' : '📸 Capture'}
        </button>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap');

        .posture-hud {
          position: absolute;
          bottom: 0; left: 0; right: 0;
          padding: 10px 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          border-radius: 0 0 24px 24px;
          backdrop-filter: blur(8px);
          transition: background 0.3s ease, border 0.3s ease, color 0.3s ease;
          z-index: 15;
        }
        .posture-icon { font-size: 1.2rem; }
        .posture-text { font-size: 0.92rem; font-weight: 600; }

        .divider {
          width: 1px; height: 40px;
          background: rgba(255,255,255,0.15);
          margin: 0 4px;
        }

        .capture-btn {
          padding: 0 20px;
          height: 60px;
          border-radius: 16px;
          font-size: 0.9rem;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
          white-space: nowrap;
          border: 1px solid;
          font-family: inherit;
        }
        .capture-btn.ready {
          background: rgba(100,108,255,0.25);
          border-color: #646cff;
          color: #fff;
          box-shadow: 0 0 20px rgba(100,108,255,0.3);
        }
        .capture-btn.ready:hover {
          background: rgba(100,108,255,0.4);
          transform: translateY(-3px) scale(1.03);
        }
        .capture-btn.disabled {
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.3);
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}

export default App;
