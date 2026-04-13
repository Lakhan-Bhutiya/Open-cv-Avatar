import React, { useCallback, useRef, useState } from 'react';
import { useServerRTC } from './hooks/useServerRTC';

// No hardcoded CAPS array. Wait for user to upload.

export default function ServerApp() {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const [caps, setCaps] = useState<{id: number, path: string}[]>([]);
  const [selectedCapIndex, setSelectedCapIndex] = useState(0);
  const [captured, setCaptured] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isConnected, error } = useServerRTC({
    localVideoRef,
    remoteVideoRef,
    capIndex: selectedCapIndex,
  });

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const baseServerUrl = (import.meta.env.VITE_SERVERURL as string || 'http://localhost:5025').replace('/offer', '');
      const response = await fetch(`${baseServerUrl}/upload_cap`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || data.error) {
         alert(data.error || "Failed to upload cap.");
      } else {
         const newCap = { id: data.cap_index, path: `${baseServerUrl}${data.url}` };
         setCaps(prev => [...prev, newCap]);
         setSelectedCapIndex(data.cap_index);
      }
    } catch (err) {
      alert("Error connecting to server to upload cap.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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
    const capIdStr = caps.length > 0 && caps[selectedCapIndex] ? caps[selectedCapIndex].id : 'none';
    link.download = `cap_try_on_server_${capIdStr}.jpg`;
    link.href = out.toDataURL('image/jpeg', 0.92);
    link.click();
    setCaptured(true);
    setTimeout(() => setCaptured(false), 2000);
  }, [selectedCapIndex, caps]);

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
        {/* Hidden local video (just to grab webcam) */}
        <video 
          ref={localVideoRef} 
          autoPlay 
          playsInline 
          muted 
          style={{ display: 'none' }} 
        />
        
        {/* The video rendered by the Python server */}
        <video 
          ref={remoteVideoRef} 
          autoPlay 
          playsInline 
          muted 
          className="output_canvas"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>

      <div className="controls glass-panel">
        <input 
          type="file" 
          accept="image/png, image/webp" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          onChange={handleFileChange} 
        />
        
        <button className="upload-btn" onClick={handleUploadClick} disabled={isUploading}>
          {isUploading ? 'Uploading...' : '📤 Upload Cap PNG'}
        </button>

        <div className="divider" />
        
        {caps.length === 0 ? (
           <span style={{ fontSize: '0.9rem', opacity: 0.7 }}>Upload your first transparent hat!</span>
        ) : (
          caps.map((cap, i) => (
            <button
              key={cap.id}
              className={`cap-btn ${selectedCapIndex === cap.id ? 'active' : ''}`}
              onClick={() => setSelectedCapIndex(cap.id)}
            >
              <img src={cap.path} alt={`Cap ${cap.id}`} style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
            </button>
          ))
        )}

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
        .upload-btn {
          padding: 0 16px;
          height: 50px;
          border-radius: 12px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.1);
          color: white;
          white-space: nowrap;
          transition: all 0.2s;
        }
        .upload-btn:hover {
          background: rgba(255,255,255,0.2);
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
        .output_canvas {
            /* the Python server already handles the mirror flip. */
        }
      `}</style>
    </div>
  );
}
