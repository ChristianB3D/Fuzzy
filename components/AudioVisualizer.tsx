
import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isActive: boolean;
  inputAnalyser: AnalyserNode | null;
  outputAnalyser: AnalyserNode | null;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ isActive, inputAnalyser, outputAnalyser }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!isActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bars = 32;
    const barWidth = 4;
    const gap = 4;
    
    // Data arrays
    const inputData = new Uint8Array(bars);
    const outputData = new Uint8Array(bars);

    let animationId: number;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (inputAnalyser) inputAnalyser.getByteFrequencyData(inputData);
      if (outputAnalyser) outputAnalyser.getByteFrequencyData(outputData);

      for (let i = 0; i < bars; i++) {
        // Draw Input (Bottom up, Blue/Teal)
        const inputHeight = (inputData[i] / 255) * (canvas.height / 2);
        ctx.fillStyle = '#0d9488'; // Teal
        ctx.beginPath();
        ctx.roundRect(i * (barWidth + gap), canvas.height / 2 - inputHeight, barWidth, inputHeight, 2);
        ctx.fill();

        // Draw Output (Top down, Orange)
        const outputHeight = (outputData[i] / 255) * (canvas.height / 2);
        ctx.fillStyle = '#ea580c'; // Orange
        ctx.beginPath();
        ctx.roundRect(i * (barWidth + gap), canvas.height / 2, barWidth, outputHeight, 2);
        ctx.fill();
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [isActive, inputAnalyser, outputAnalyser]);

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas 
        ref={canvasRef} 
        width={256} 
        height={160} 
        className="rounded-xl"
      />
      <div className="flex gap-8">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-teal-600"></div>
          <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">You</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-orange-600"></div>
          <span className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Fuzzy</span>
        </div>
      </div>
    </div>
  );
};

export default AudioVisualizer;
