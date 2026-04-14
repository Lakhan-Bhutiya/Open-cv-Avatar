import React, { useCallback, useRef, useState } from 'react';
import { useServerRTC } from './hooks/useServerRTC';

// Caps are now dynamically renamed up to cap_8.png
const CAPS = [
  { id: 1, path: '/assets/caps/cap_0.png' },
  { id: 2, path: '/assets/caps/cap_1.png' },
  { id: 3, path: '/assets/caps/cap_2.png' },
  { id: 4, path: '/assets/caps/cap_3.png' },
  { id: 5, path: '/assets/caps/cap_4.png' },
  { id: 6, path: '/assets/caps/cap_5.png' },
  { id: 7, path: '/assets/caps/cap_6.png' },
  { id: 8, path: '/assets/caps/cap_7.png' },
  { id: 9, path: '/assets/caps/cap_8.png' },
  { id: 10, path: '/assets/caps/cap_9.png' },
];

export default function ServerApp() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const [selectedCapIndex, setSelectedCapIndex] = useState(0);
  const [captured, setCaptured] = useState(false);
  const [isRemotePlaying, setIsRemotePlaying] = useState(false);

  const { isConnected, error } = useServerRTC({
    localVideoRef,
    remoteVideoRef,
    capIndex: selectedCapIndex,
  });

  const handleCapture = useCallback(() => {
    const video = remoteVideoRef.current;
    if (!video) return;

    const W = video.videoWidth;
    const H = video.videoHeight;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d')!;

    // Note: The Python server already mirrors the status banner,
    // but the raw imagery might need mirroring if we want a selfie view,
    // or maybe the Python server handles it? Actually, if Python processes it,
    // we should just draw the frame exactly as it comes back.
    // The browser webcam is implicitly mirrored in standard React overlay App via CSS.
    // Let's just draw what Python gives us. If we need to flip it, we would flip it.
    // Let's start with a direct copy since the server already composited the text correctly (un-mirrored text).
    ctx.drawImage(video, 0, 0, W, H);

    const link = document.createElement('a');
    link.download = `cap_try_on_server_${CAPS[selectedCapIndex].id}.jpg`;
    link.href = out.toDataURL('image/jpeg', 0.92);
    link.click();
    setCaptured(true);
    setTimeout(() => setCaptured(false), 2000);
  }, [selectedCapIndex]);

  return (
    <div className="app-container">
      <header className="header">
        <h1>Cap Try-On (Server)</h1>
        <p>Real-time Python-powered WebRTC</p>
      </header>

      <div className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
        <div className="pulse" />
        {isConnected ? 'Server Connected' : error || 'Connecting...'}
      </div>

      <div className="video-container glass-panel" style={{ position: 'relative' }}>
        {/* The video rendered by the Python server (underneath) */}
        <video 
          ref={remoteVideoRef} 
          autoPlay 
          playsInline 
          muted 
          className="output_canvas"
          onPlaying={() => setIsRemotePlaying(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />

        {/* Local raw webcam overlay on top until remote plays */}
        <video 
          ref={localVideoRef} 
          autoPlay 
          playsInline 
          muted 
          className="mirror-video"
          style={{ 
            display: isRemotePlaying ? 'none' : 'block',
            position: 'absolute', top: 0, left: 0,
            width: '100%', height: '100%', objectFit: 'cover'
          }} 
        />
      </div>

      <div className="controls glass-panel">
        {CAPS.map((cap, i) => (
          <button
            key={cap.id}
            className={`cap-btn ${selectedCapIndex === i ? 'active' : ''}`}
            onClick={() => setSelectedCapIndex(i)}
          >
            <img src={cap.path} alt={`Cap ${cap.id}`} />
          </button>
        ))}

        <div className="divider" />

        <button
          className={`capture-btn ${isConnected ? 'ready' : 'disabled'}`}
          onClick={handleCapture}
          disabled={!isConnected}
        >
          {captured ? '✓ Saved!' : '📸 Capture'}
        </button>
      </div>

      <style>{`
        /* Reuse CSS from App.tsx */
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap');
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
        video {
            transform: none !important;
        }
        .mirror-video {
            transform: scaleX(-1) !important;
        }
        .output_canvas {
            /* the Python server already handles the mirror flip. */
        }
      `}</style>
    </div>
  );
}
