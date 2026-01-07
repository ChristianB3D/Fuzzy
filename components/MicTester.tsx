
import React, { useState, useRef, useEffect } from 'react';

const MicTester: React.FC = () => {
  const [isTesting, setIsTesting] = useState(false);
  const [volume, setVolume] = useState(0);
  const [permissionState, setPermissionState] = useState<string>('unknown');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Check initial permission state
  useEffect(() => {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' as PermissionName })
        .then((result) => {
          setPermissionState(result.state);
          result.onchange = () => setPermissionState(result.state);
        })
        .catch(() => setPermissionState('not supported'));
    }
  }, []);

  const startTest = async () => {
    try {
      // 1. Request Stream with explicit constraints
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      streamRef.current = stream;
      
      // Log track info for debugging
      const audioTrack = stream.getAudioTracks()[0];
      console.log(`[Fuzzy Mic Test] Active Track: ${audioTrack.label}`);
      
      // 2. Setup Context
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      const silentGain = ctx.createGain();
      
      analyser.fftSize = 512;
      silentGain.gain.value = 0; // Absolute silence
      
      // Route: Source -> Analyser -> Silent Gain -> Destination
      // Connecting to destination is required by some browsers to keep the stream 'hot'
      source.connect(analyser);
      analyser.connect(silentGain);
      silentGain.connect(ctx.destination);
      
      analyserRef.current = analyser;
      setIsTesting(true);
      
      // 3. Time Domain Analysis
      const dataArray = new Uint8Array(analyser.fftSize);
      const update = () => {
        if (!analyserRef.current || !audioCtxRef.current) return;
        
        // Defensive resume for backgrounded tabs
        if (audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume();
        }

        analyserRef.current.getByteTimeDomainData(dataArray);
        
        let peak = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const amplitude = Math.abs(dataArray[i] - 128);
          if (amplitude > peak) peak = amplitude;
        }
        
        // Normalize 0-128 to 0-100 with sensitivity boost
        const level = (peak / 128) * 100;
        setVolume(level);
        
        rafIdRef.current = requestAnimationFrame(update);
      };
      update();
    } catch (err: any) {
      console.error("Mic access failed:", err);
      let errorMsg = "Fuzzy couldn't access your microphone.";
      if (err.name === 'NotAllowedError') {
        errorMsg = "Microphone access was denied. Please check your browser's address bar for the camera/mic icon to reset permissions.";
      } else if (err.name === 'NotFoundError') {
        errorMsg = "No microphone was found. Please ensure your mic is plugged in and recognized by your system.";
      }
      alert(errorMsg);
    }
  };

  const stopTest = () => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close();
    }
    setIsTesting(false);
    setVolume(0);
  };

  const playTestSound = async () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      await ctx.resume();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.3); // C6
      
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
      
      setTimeout(() => {
        if (ctx.state !== 'closed') ctx.close();
      }, 500);
    } catch (e) {
      console.error("Speaker test failed", e);
    }
  };

  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    };
  }, []);

  return (
    <div className="glass p-6 rounded-[2rem] border border-orange-100 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-black uppercase text-orange-900/60 tracking-widest">Audio Diagnostics</h3>
        {isTesting && (
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-bold text-red-600 uppercase">Live</span>
            <span className="flex h-2 w-2 rounded-full bg-red-500 animate-pulse"></span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
           <button 
            onClick={isTesting ? stopTest : startTest}
            className={`flex-1 py-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2 shadow-sm ${isTesting ? 'bg-slate-900 text-white' : 'bg-orange-50 text-orange-800 border border-orange-100 hover:bg-orange-100'}`}
           >
            <i className={`fa-solid ${isTesting ? 'fa-stop-circle' : 'fa-microphone'}`}></i>
            {isTesting ? 'Stop Test' : 'Test Mic'}
           </button>
           
           <button 
            onClick={playTestSound}
            className="w-12 h-12 bg-white border border-orange-100 text-orange-800 rounded-xl flex items-center justify-center hover:bg-orange-50 transition-colors shadow-sm"
            title="Sound Check"
           >
            <i className="fa-solid fa-volume-high"></i>
           </button>
        </div>

        {isTesting && (
          <div className="space-y-1">
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div 
                className="h-full bg-teal-500 transition-all duration-75 ease-out"
                style={{ width: `${Math.min(100, volume * 1.5)}%` }} 
              ></div>
            </div>
            <div className="flex justify-between px-1">
               <span className="text-[8px] font-black text-slate-400 uppercase">Silence</span>
               <span className="text-[8px] font-black text-slate-400 uppercase">Active</span>
            </div>
          </div>
        )}
        
        <div className="bg-slate-50/50 p-3 rounded-xl border border-slate-100">
          <p className="text-[10px] text-slate-500 font-bold leading-tight flex items-center gap-2">
            <i className={`fa-solid ${permissionState === 'granted' ? 'fa-circle-check text-green-500' : 'fa-shield-halved'}`}></i>
            Browser Permission: <span className="uppercase text-slate-700">{permissionState}</span>
          </p>
          {!isTesting && (
            <p className="text-[9px] text-slate-400 mt-2 italic">
              * Click "Test Mic" to verify Fuzzy can hear you.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default MicTester;
