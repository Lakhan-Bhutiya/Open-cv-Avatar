import { useEffect, useRef, useState } from 'react';


export const useFaceMesh = (videoElement: HTMLVideoElement | null) => {
  const [results, setResults] = useState<any | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const faceMeshRef = useRef<any | null>(null);
  const cameraRef = useRef<any | null>(null);

  useEffect(() => {
    if (!videoElement) return;

    // @ts-ignore
    const faceMesh = new window.FaceMesh({
      locateFile: (file: string) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`;
      },
    });

    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    faceMesh.onResults((results: any) => {
      setResults(results);
      setIsConnected(true);
    });

    faceMeshRef.current = faceMesh;

    // @ts-ignore
    const camera = new window.Camera(videoElement, {
      onFrame: async () => {
        await faceMesh.send({ image: videoElement });
      },
      width: 640,
      height: 480,
    });

    camera.start().catch((err: any) => {
      console.error('Camera error:', err);
      setIsConnected(false);
    });

    cameraRef.current = camera;

    return () => {
      camera.stop();
      faceMesh.close();
    };
  }, [videoElement]);

  return { results, isConnected };
};
