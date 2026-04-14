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
];

export default function ServerApp() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const [selectedCapIndex, setSelectedCapIndex] = useState(0);
  const [captured, setCaptured] = useState(false);
  const [isRemotePlaying, setIsRemotePlaying] = useState(false);

  const { isConnected, error, status, statusMessage, isDebugActive, toggleDebug } = useServerRTC({
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

    // Draw the remote video frame
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

      <div className="video-container glass-panel" style={{ position: 'relative', overflow: 'hidden' }}>
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

        {/* Premium Frontend Warning Banner */}
        {isConnected && isRemotePlaying && (
          <div className={`prompt-overlay ${status}`}>
            <span className="prompt-icon">
              {status === 'ok' ? '✓' : status === 'warning' ? '⚠' : '❗'}
            </span>
            <span className="prompt-text">{statusMessage}</span>
          </div>
        )}
      </div>

      <div className="controls glass-panel">
        <div className="caps-scroll" style={{ display: 'flex', gap: '12px', overflowX: 'auto', padding: '4px' }}>
          {CAPS.map((cap, i) => (
            <button
              key={cap.id}
              className={`cap-btn ${selectedCapIndex === i ? 'active' : ''}`}
              onClick={() => setSelectedCapIndex(i)}
            >
              <img src={cap.path} alt={`Cap ${cap.id}`} />
            </button>
          ))}
        </div>

        <div className="divider" />

        <div className="action-buttons" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            className={`debug-btn ${isDebugActive ? 'active' : ''}`}
            onClick={toggleDebug}
            title="Toggle Debug Mode"
          >
            {isDebugActive ? '👁 Visible' : '👁 Debug'}
          </button>

          <button
            className={`capture-btn ${isConnected ? 'ready' : 'disabled'}`}
            onClick={handleCapture}
            disabled={!isConnected}
          >
            {captured ? '✓ Saved!' : '📸 Capture'}
          </button>
        </div>
      </div>

      <style>{`
        /* Reuse CSS from App.tsx */
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap');
        
        .debug-btn {
          padding: 0 16px;
          height: 50px;
          border-radius: 14px;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: rgba(255, 255, 255, 0.7);
          font-family: inherit;
        }
        .debug-btn.active {
          background: rgba(34, 197, 94, 0.15);
          border-color: #22c55e;
          color: #22c55e;
          box-shadow: 0 0 15px rgba(34, 197, 94, 0.2);
        }

        .prompt-overlay {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          padding: 12px 24px;
          border-radius: 20px;
          display: flex;
          align-items: center;
          gap: 12px;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          z-index: 100;
          animation: slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          max-width: 90%;
        }

        .prompt-overlay.ok {
          background: rgba(34, 197, 94, 0.2);
          border-color: rgba(34, 197, 94, 0.3);
        }
        .prompt-overlay.warning {
          background: rgba(251, 146, 60, 0.2);
          border-color: rgba(251, 146, 60, 0.3);
        }
        .prompt-overlay.error {
          background: rgba(239, 68, 68, 0.2);
          border-color: rgba(239, 68, 68, 0.3);
        }

        .prompt-icon {
          font-size: 1.2rem;
          font-weight: bold;
        }
        .ok .prompt-icon { color: #22c55e; }
        .warning .prompt-icon { color: #fb923c; }
        .error .prompt-icon { color: #ef4444; }

        .prompt-text {
          color: white;
          font-weight: 600;
          font-size: 0.95rem;
          white-space: nowrap;
          font-family: 'Outfit', sans-serif;
        }

        @keyframes slideUp {
          from { transform: translate(-50%, 20px); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }

        .divider {
          width: 1px; height: 40px;
          background: rgba(255,255,255,0.15);
          margin: 0 4px;
        }
        .capture-btn {
          padding: 0 20px;
          height: 50px;
          border-radius: 14px;
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
