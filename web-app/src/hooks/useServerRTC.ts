import { useEffect, useState, useRef } from 'react';

interface UseServerRTCProps {
  localVideoRef: React.RefObject<HTMLVideoElement>;
  remoteVideoRef: React.RefObject<HTMLVideoElement>;
  serverUrl?: string;
  capIndex?: number;
}



export function useServerRTC({
  localVideoRef,
  remoteVideoRef,
  serverUrl = import.meta.env.VITE_SERVERURL,
  capIndex = 0
}: UseServerRTCProps) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'ok' | 'warning' | 'error'>('error');
  const [statusMessage, setStatusMessage] = useState('Connecting to server...');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const latestCapIndex = useRef(capIndex);

  // When cap index changes, send it over the data channel if connected
  useEffect(() => {
    latestCapIndex.current = capIndex;
    
    const sendCap = () => {
      if (dcRef.current && dcRef.current.readyState === 'open') {
        try {
          dcRef.current.send(JSON.stringify({ type: 'change_cap', cap_index: capIndex }));
        } catch (e) {
          console.error('Failed to send change_cap:', e);
        }
      }
    };
    
    sendCap();
    // Mobile fallback timer to ensure DataChannel caught the event
    const timer = setTimeout(sendCap, 400);
    return () => clearTimeout(timer);
  }, [capIndex]);

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        // 1. Get Local Webcam
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (!active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // 2. Setup Peer Connection
        const pc = new RTCPeerConnection({
          sdpSemantics: 'unified-plan',
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
          ]
        } as any);
        pcRef.current = pc;

        // 3. Create DataChannel to change caps
        const dc = pc.createDataChannel('control');
        dcRef.current = dc;
        dc.onopen = () => {
          // Send initial cap index
          dc.send(JSON.stringify({ type: 'change_cap', cap_index: latestCapIndex.current }));
        };

        dc.onmessage = (evt) => {
          try {
            const data = JSON.parse(evt.data);
            if (data.type === 'status') {
              setStatus(data.status);
              setStatusMessage(data.message);
            }
          } catch (e) {
            console.error('Failed to parse dc message:', e);
          }
        };

        // 4. Handle incoming processed video from server
        pc.addEventListener('track', (evt) => {
          if (evt.track.kind === 'video' && remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = evt.streams[0];
          }
        });

        pc.addEventListener('connectionstatechange', () => {
          if (pc.connectionState === 'connected') {
            setIsConnected(true);
            setError(null);
          } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
            setIsConnected(false);
            if (active) setError('WebRTC Connection failed or closed');
          }
        });

        // 5. Add our webcam track to connection
        stream.getTracks().forEach(track => {
          pc.addTrack(track, stream);
        });

        // 6. Negotiate WebRTC with python server
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Await ICE gathering completion (simple trick: wait a short bit or check ICE state)
        await new Promise<void>((resolve) => {
          if (pc.iceGatheringState === 'complete') {
            resolve();
          } else {
            const checkState = () => {
              if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', checkState);
                resolve();
              }
            };
            pc.addEventListener('icegatheringstatechange', checkState);
            // backup timeout
            setTimeout(resolve, 2000);
          }
        });

        if (!serverUrl) {
          throw new Error('Server URL is not defined. Please set VITE_SERVERURL in your .env file.');
        }

        const response = await fetch(serverUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sdp: pc.localDescription?.sdp,
            type: pc.localDescription?.type,
          }),
        });

        if (!response.ok) {
          throw new Error('Server returned ' + response.status);
        }

        const answer = await response.json();
        await pc.setRemoteDescription(answer);

      } catch (err: any) {
        if (active) {
          console.error('WebRTC Error:', err);
          setError(err.message || 'Failed to connect');
        }
      }
    }

    start();

    return () => {
      active = false;
      if (pcRef.current) {
        pcRef.current.close();
      }
      if (localVideoRef.current?.srcObject) {
        const str = localVideoRef.current.srcObject as MediaStream;
        str.getTracks().forEach(t => t.stop());
      }
    };
  }, [serverUrl, localVideoRef, remoteVideoRef]);

  return { isConnected, error, status, statusMessage };
}
