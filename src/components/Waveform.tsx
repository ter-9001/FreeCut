
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface WaveformProps {
  path: string;
  color: string;
  pixelsPerSecond: number;
  duration: number;
}

 const Waveform = ({ path, color }: { path: string, color: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<number[]>([]);

  useEffect(() => {
    // Take datas from Rust
    invoke<number[]>('get_waveform_data', { path, samples: 200 })
      .then(setData)
      .catch(console.error);
  }, [path]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;

    const barWidth = canvas.width / data.length;
    data.forEach((peak, i) => {
      const height = peak * canvas.height;
      const x = i * barWidth;
      const y = (canvas.height - height) / 2;
      ctx.fillRect(x, y, barWidth - 1, height); 
    });
  }, [data, color]);

  return <canvas ref={canvasRef} className="w-full h-full opacity-40 pointer-events-none " />;
};

export default Waveform;