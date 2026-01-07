
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, GenerateContentResponse, LiveServerMessage, Modality } from "@google/genai";
import { CABIN_DETAILS, FUZZY_SYSTEM_INSTRUCTION } from './constants';
import { Message, SessionStatus } from './types';
import InfoCard from './components/InfoCard';
import AudioVisualizer from './components/AudioVisualizer';
import MicTester from './components/MicTester';
import { decode, createPcmBlob, createAudioBufferFromPcm } from './services/audio-helpers';

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'fuzzy',
      text: "Welcome to Fuzzy Bear Cabin! I'm Fuzzy, your digital concierge. I'm ready to help via text or a real-time voice call. How can I assist you today?",
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasKey, setHasKey] = useState<boolean>(true);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  
  // Audio Refs
  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  // Analysers & Gain
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);

  // Transcription Buffers
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, sessionStatus]);

  const startVoiceSession = async () => {
    try {
      setSessionStatus(SessionStatus.CONNECTING);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      audioContextInRef.current = inCtx;
      audioContextOutRef.current = outCtx;

      await inCtx.resume();
      await outCtx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      inputAnalyserRef.current = inCtx.createAnalyser();
      inputAnalyserRef.current.fftSize = 256;
      
      outputAnalyserRef.current = outCtx.createAnalyser();
      outputAnalyserRef.current.fftSize = 256;
      outputGainRef.current = outCtx.createGain();
      outputGainRef.current.gain.value = 2.0; 
      
      outputAnalyserRef.current.connect(outputGainRef.current);
      outputGainRef.current.connect(outCtx.destination);

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          },
          systemInstruction: FUZZY_SYSTEM_INSTRUCTION + "\nIMPORTANT: You are in VOICE MODE. Speak clearly and warmly. Keep responses concise.",
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [{googleSearch: {}}]
        },
        callbacks: {
          onopen: () => {
            setSessionStatus(SessionStatus.ACTIVE);
            outCtx.resume();
            const source = inCtx.createMediaStreamSource(stream);
            const processor = inCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = processor;
            source.connect(inputAnalyserRef.current!);
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const pcmBlob = createPcmBlob(inputData);
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(processor);
            processor.connect(inCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              currentInputTranscription.current += message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              currentOutputTranscription.current += message.serverContent.outputTranscription.text;
            }
            if (message.serverContent?.turnComplete) {
              const uTxt = currentInputTranscription.current;
              const fTxt = currentOutputTranscription.current;
              if (uTxt || fTxt) {
                setMessages(prev => [
                  ...prev,
                  ...(uTxt ? [{ role: 'user' as const, text: uTxt, timestamp: new Date() }] : []),
                  ...(fTxt ? [{ role: 'fuzzy' as const, text: fTxt, timestamp: new Date() }] : [])
                ]);
              }
              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
            }
            const audioBase64 = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioBase64 && audioContextOutRef.current) {
              const ctx = audioContextOutRef.current;
              if (ctx.state === 'suspended') await ctx.resume();
              const rawData = decode(audioBase64);
              const audioBuffer = await createAudioBufferFromPcm(rawData, ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputAnalyserRef.current!);
              source.onended = () => activeSourcesRef.current.delete(source);
              const now = ctx.currentTime;
              if (nextStartTimeRef.current < now) nextStartTimeRef.current = now;
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              activeSourcesRef.current.add(source);
            }
          },
          onclose: () => stopVoiceSession(),
          onerror: (e) => {
            console.error("Session Error:", e);
            setSessionStatus(SessionStatus.ERROR);
            stopVoiceSession();
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err) {
      console.error("Audio Initiation Error:", err);
      setSessionStatus(SessionStatus.ERROR);
    }
  };

  const stopVoiceSession = async () => {
    if (sessionPromiseRef.current) {
      const session = await sessionPromiseRef.current;
      try { session.close(); } catch(e) {}
      sessionPromiseRef.current = null;
    }
    activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    activeSourcesRef.current.clear();
    if (scriptProcessorRef.current) { scriptProcessorRef.current.disconnect(); scriptProcessorRef.current = null; }
    if (audioContextInRef.current) { try { await audioContextInRef.current.close(); } catch(e) {} }
    if (audioContextOutRef.current) { try { await audioContextOutRef.current.close(); } catch(e) {} }
    audioContextInRef.current = null; audioContextOutRef.current = null;
    setSessionStatus(SessionStatus.IDLE);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() || isTyping) return;

    const userMessage: Message = { role: 'user', text: inputValue, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [{ role: 'user', parts: [{ text: userMessage.text }] }],
        config: { 
          systemInstruction: FUZZY_SYSTEM_INSTRUCTION,
          tools: [{googleSearch: {}}]
        }
      });

      const text = response.text || "";
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      const sources = chunks?.map((c: any) => ({
        uri: c.web?.uri || c.maps?.uri,
        title: c.web?.title || c.maps?.title || "Supporting Document"
      })).filter((s: any) => s.uri) || [];

      // If text mentions guest guide but no sources found, add hardcoded one
      if (text.toLowerCase().includes("guest guide") && sources.length === 0) {
        sources.push({
          uri: "https://www.fuzzybearcabin.com/Guest-Guide-2c1da90eda4d80c18bbecc3553c06632",
          title: "Official Guest Guide"
        });
      }

      setMessages(prev => [...prev, { role: 'fuzzy', text, timestamp: new Date(), sources }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'fuzzy', text: "I'm having trouble connecting to the cabin guides. Please contact Barbara at 650-430-0946.", timestamp: new Date() }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#fdfaf6] h-screen overflow-hidden text-slate-900">
      {!hasKey && (
        <div className="fixed inset-0 z-[100] bg-orange-950/90 backdrop-blur-xl flex items-center justify-center p-6 text-center">
          <div className="max-w-md bg-white p-10 rounded-[2.5rem] shadow-2xl">
            <h2 className="text-3xl font-bold mb-4">Cabin Concierge</h2>
            <button onClick={handleSelectKey} className="w-full py-4 bg-orange-700 text-white rounded-2xl font-bold">Connect Now</button>
          </div>
        </div>
      )}

      {/* CALL OVERLAY */}
      {sessionStatus !== SessionStatus.IDLE && (
        <div className="fixed inset-0 z-[60] bg-white/98 backdrop-blur-3xl flex flex-col items-center justify-center p-8 text-center">
          <div className="w-40 h-40 bg-orange-800 text-white rounded-[3rem] flex items-center justify-center mb-8 relative shadow-2xl">
             <div className={`absolute inset-[-20px] bg-orange-500/10 rounded-full animate-pulse ${sessionStatus === SessionStatus.ACTIVE ? 'block' : 'hidden'}`}></div>
             <i className="fa-solid fa-phone-volume text-6xl"></i>
          </div>
          <h2 className="text-5xl font-black mb-3 tracking-tighter">Live with Fuzzy</h2>
          <div className="bg-slate-50 p-12 rounded-[4rem] border border-orange-100 shadow-inner mb-12">
            <AudioVisualizer isActive={sessionStatus === SessionStatus.ACTIVE} inputAnalyser={inputAnalyserRef.current} outputAnalyser={outputAnalyserRef.current} />
          </div>
          <button onClick={stopVoiceSession} className="bg-slate-900 text-white px-12 py-6 rounded-[2.5rem] font-black text-2xl hover:bg-black transition-all shadow-2xl">End Call</button>
        </div>
      )}

      <div className="flex-1 flex flex-col h-full bg-white relative">
        <header className="p-4 md:p-6 flex items-center justify-between border-b border-orange-100 bg-white/80 backdrop-blur-md z-10 shrink-0">
          <div className="flex items-center gap-4">
            <div className="bg-orange-800 text-white w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg"><i className="fa-solid fa-paw text-xl"></i></div>
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-none">Fuzzy</h1>
              <p className="text-[10px] font-black text-orange-700/60 uppercase tracking-widest mt-1">Arnold Guest Concierge</p>
            </div>
          </div>
          <button onClick={startVoiceSession} className="flex items-center gap-3 bg-orange-700 text-white px-6 py-3 rounded-2xl font-black hover:bg-orange-800 shadow-xl transition-all active:scale-95 text-sm uppercase tracking-wider">
            <i className="fa-solid fa-phone-volume"></i> Voice Call
          </button>
        </header>

        <main ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 bg-slate-50/20" style={{ backgroundImage: 'radial-gradient(#e5e7eb 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-2`}>
              <div className={`max-w-[85%] p-6 rounded-3xl shadow-sm ${msg.role === 'user' ? 'bg-orange-700 text-white rounded-tr-none' : 'bg-orange-50/90 text-gray-800 border border-orange-100 rounded-tl-none'}`}>
                <p className="text-[16px] font-medium leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-orange-200/50 flex flex-wrap gap-2">
                    {msg.sources.map((source, sIdx) => (
                      <a 
                        key={sIdx} 
                        href={source.uri} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 bg-white/60 hover:bg-white px-3 py-1.5 rounded-xl border border-orange-200 text-[11px] font-bold text-orange-800 transition-colors shadow-sm"
                      >
                        <i className="fa-solid fa-book-open"></i>
                        {source.title.length > 25 ? source.title.substring(0, 25) + '...' : source.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-[10px] font-black text-slate-400 mt-2 uppercase tracking-widest px-2">{msg.role} • {msg.timestamp.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
            </div>
          ))}
          {isTyping && <div className="text-[10px] font-black text-orange-800 animate-pulse uppercase tracking-widest p-4">Consulting Cabin Guide...</div>}
        </main>

        <footer className="p-4 md:p-6 bg-white border-t border-orange-100 shrink-0">
          <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-3">
            <input 
              type="text" 
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask Fuzzy about guests, check-out, or house rules..."
              className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-6 py-5 focus:outline-none focus:border-orange-600 font-semibold shadow-inner"
              disabled={isTyping}
            />
            <button type="submit" disabled={!inputValue.trim() || isTyping} className="w-16 h-16 bg-orange-700 text-white rounded-2xl font-bold transition-all hover:bg-orange-800 shadow-xl flex items-center justify-center active:scale-95">
              <i className="fa-solid fa-paper-plane text-xl"></i>
            </button>
          </form>
        </footer>
      </div>

      <aside className="hidden lg:flex w-[400px] flex-col bg-white border-l border-orange-50 p-10 overflow-y-auto shrink-0">
        <h2 className="text-3xl font-black mb-8 tracking-tighter">Tools & Guide</h2>
        <div className="space-y-6">
          <MicTester />
          <InfoCard title="Wi-Fi" icon="fa-wifi" value={CABIN_DETAILS.wifiName} description={CABIN_DETAILS.wifiPass} />
          <div className="grid grid-cols-2 gap-4">
            <InfoCard title="In" icon="fa-clock" value={CABIN_DETAILS.checkIn} />
            <InfoCard title="Out" icon="fa-door-open" value={CABIN_DETAILS.checkOut} />
          </div>
          <div className="mt-10 pt-8 border-t border-slate-100">
            <h3 className="text-[10px] font-black uppercase text-slate-400 mb-6 tracking-widest">Rules Snapshot</h3>
            <ul className="space-y-4">
              {CABIN_DETAILS.rules.map((rule, i) => (
                <li key={i} className="flex items-start gap-4 text-sm text-slate-600 font-bold leading-snug">
                  <div className="w-5 h-5 bg-orange-50 rounded-full flex items-center justify-center shrink-0 mt-0.5"><i className="fa-solid fa-check text-[10px] text-orange-600"></i></div>
                  <span>{rule}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
};

export default App;
