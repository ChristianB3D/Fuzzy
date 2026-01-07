
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
      text: "Fuzzy v2.3 Online. I'm connected to the Fuzzy Bear Cabin guides and ready to help. How is your stay going?",
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [envKeyExists, setEnvKeyExists] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  
  const getApiKey = () => {
    return (import.meta as any).env?.VITE_API_KEY || (globalThis as any).process?.env?.API_KEY || "";
  };

  const audioContextInRef = useRef<AudioContext | null>(null);
  const audioContextOutRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);

  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  useEffect(() => {
    const key = getApiKey();
    setEnvKeyExists(!!key && key.length > 10);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping, sessionStatus]);

  const verifyConnection = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
       alert("API Key is missing. Please add 'API_KEY' to your Vercel Environment Variables.");
       return;
    }
    setIsVerifying(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: 'test',
        config: { maxOutputTokens: 1 }
      });
      alert("✅ Connection Successful! Fuzzy's brain is active.");
    } catch (e: any) {
      alert(`❌ Connection Failed: ${e.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  const startVoiceSession = async () => {
    const apiKey = getApiKey();
    if (!apiKey) {
      alert("Voice requires an API Key.");
      return;
    }

    try {
      setSessionStatus(SessionStatus.CONNECTING);
      const ai = new GoogleGenAI({ apiKey });
      const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      audioContextInRef.current = inCtx;
      audioContextOutRef.current = outCtx;

      await inCtx.resume();
      await outCtx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      inputAnalyserRef.current = inCtx.createAnalyser();
      outputAnalyserRef.current = outCtx.createAnalyser();
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } }
          },
          systemInstruction: FUZZY_SYSTEM_INSTRUCTION + "\nVOICE MODE: Keep answers under 15 words.",
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            setSessionStatus(SessionStatus.ACTIVE);
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
            if (message.serverContent?.inputTranscription) currentInputTranscription.current += message.serverContent.inputTranscription.text;
            if (message.serverContent?.outputTranscription) currentOutputTranscription.current += message.serverContent.outputTranscription.text;
            
            if (message.serverContent?.turnComplete) {
              const u = currentInputTranscription.current;
              const f = currentOutputTranscription.current;
              if (u || f) {
                setMessages(prev => [
                  ...prev,
                  ...(u ? [{ role: 'user' as const, text: u, timestamp: new Date() }] : []),
                  ...(f ? [{ role: 'fuzzy' as const, text: f, timestamp: new Date() }] : [])
                ]);
              }
              currentInputTranscription.current = '';
              currentOutputTranscription.current = '';
            }

            const audioBase64 = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioBase64 && audioContextOutRef.current) {
              const ctx = audioContextOutRef.current;
              const rawData = decode(audioBase64);
              const audioBuffer = await createAudioBufferFromPcm(rawData, ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputAnalyserRef.current!);
              source.connect(ctx.destination);
              const now = ctx.currentTime;
              if (nextStartTimeRef.current < now) nextStartTimeRef.current = now;
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              activeSourcesRef.current.add(source);
            }
          },
          onclose: () => stopVoiceSession(),
          onerror: () => stopVoiceSession()
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (err) {
      console.error(err);
      setSessionStatus(SessionStatus.IDLE);
    }
  };

  const stopVoiceSession = async () => {
    if (sessionPromiseRef.current) {
      const session = await sessionPromiseRef.current;
      try { session.close(); } catch(e) {}
    }
    activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    activeSourcesRef.current.clear();
    if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
    if (audioContextInRef.current) audioContextInRef.current.close();
    if (audioContextOutRef.current) audioContextOutRef.current.close();
    setSessionStatus(SessionStatus.IDLE);
    sessionPromiseRef.current = null;
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() || isTyping) return;

    const apiKey = getApiKey();
    if (!apiKey) {
      setMessages(prev => [...prev, { role: 'fuzzy', text: "⚠️ Config Required: API_KEY is missing in Vercel.", timestamp: new Date() }]);
      return;
    }

    const userMessage: Message = { role: 'user', text: inputValue, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    try {
      const ai = new GoogleGenAI({ apiKey });
      let response;
      try {
        response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: [{ role: 'user', parts: [{ text: userMessage.text }] }],
          config: { systemInstruction: FUZZY_SYSTEM_INSTRUCTION, tools: [{googleSearch: {}}] }
        });
      } catch {
        response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: [{ role: 'user', parts: [{ text: userMessage.text }] }],
          config: { systemInstruction: FUZZY_SYSTEM_INSTRUCTION }
        });
      }

      const text = response.text || "I found the info, but had trouble phrasing it.";
      const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c: any) => ({
        uri: c.web?.uri || c.maps?.uri,
        title: c.web?.title || c.maps?.title || "Search Result"
      })).filter((s: any) => s.uri) || [];

      setMessages(prev => [...prev, { role: 'fuzzy', text, timestamp: new Date(), sources }]);
    } catch (error: any) {
      setMessages(prev => [...prev, { role: 'fuzzy', text: `Error: ${error.message}`, timestamp: new Date() }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#fdfaf6] h-screen overflow-hidden text-slate-900">
      
      {sessionStatus !== SessionStatus.IDLE && (
        <div className="fixed inset-0 z-[60] bg-white/98 backdrop-blur-3xl flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300">
          <div className="w-40 h-40 bg-orange-800 text-white rounded-[3.5rem] flex items-center justify-center mb-10 relative shadow-2xl">
             <div className="absolute inset-0 bg-orange-500/20 rounded-full animate-ping"></div>
             <i className="fa-solid fa-microphone-lines text-6xl"></i>
          </div>
          <h2 className="text-5xl font-black mb-12 tracking-tighter">Live with Fuzzy</h2>
          <AudioVisualizer isActive={sessionStatus === SessionStatus.ACTIVE} inputAnalyser={inputAnalyserRef.current} outputAnalyser={outputAnalyserRef.current} />
          <button onClick={stopVoiceSession} className="mt-12 bg-slate-900 text-white px-16 py-7 rounded-[3rem] font-black text-2xl hover:bg-black transition-all shadow-2xl active:scale-95">End Call</button>
        </div>
      )}

      <div className="flex-1 flex flex-col h-full bg-white relative">
        <header className="p-4 md:p-6 flex items-center justify-between border-b border-orange-100 bg-white/80 backdrop-blur-md z-10 shrink-0">
          <div className="flex items-center gap-4">
            <div className="bg-orange-800 text-white w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transform -rotate-2"><i className="fa-solid fa-paw text-xl"></i></div>
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight leading-none flex items-center gap-3">
                Fuzzy v2.3
                <span className={`text-[9px] px-2 py-0.5 rounded-full border ${envKeyExists ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200 animate-pulse'}`}>
                  {envKeyExists ? 'Brain: Active' : 'Brain: Missing'}
                </span>
              </h1>
              <p className="text-[10px] font-black text-orange-700/60 uppercase tracking-widest mt-1.5">Arnold Cabin Concierge</p>
            </div>
          </div>
          <button onClick={startVoiceSession} className="flex items-center gap-3 bg-orange-700 text-white px-7 py-3.5 rounded-2xl font-black hover:bg-orange-800 shadow-xl transition-all active:scale-95 text-xs uppercase tracking-widest">
            <i className="fa-solid fa-phone-volume"></i> Voice Call
          </button>
        </header>

        <main ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-10 space-y-8 bg-slate-50/20" style={{ backgroundImage: 'radial-gradient(#e5e7eb 1.5px, transparent 1.5px)', backgroundSize: '32px 32px' }}>
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in fade-in slide-in-from-bottom-4 duration-500`}>
              <div className={`max-w-[85%] p-7 rounded-[2.5rem] shadow-sm ${msg.role === 'user' ? 'bg-orange-700 text-white rounded-tr-none' : 'bg-white text-gray-800 border border-orange-100 rounded-tl-none'}`}>
                <p className="text-[16px] font-medium leading-[1.6] whitespace-pre-wrap">{msg.text}</p>
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-8 pt-6 border-t border-orange-100 flex flex-wrap gap-2">
                    {msg.sources.map((source, sIdx) => (
                      <a key={sIdx} href={source.uri} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 bg-orange-50/50 px-4 py-2 rounded-xl border border-orange-100 text-[11px] font-bold text-orange-900 hover:bg-orange-100 transition-all">
                        <i className="fa-solid fa-link text-[10px]"></i>
                        {source.title.length > 25 ? source.title.substring(0, 25) + '...' : source.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mt-3 px-3 text-[10px] font-black text-slate-300 uppercase tracking-widest">
                {msg.role} • {msg.timestamp.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
              </div>
            </div>
          ))}
          {isTyping && <div className="p-6 text-[11px] font-black text-orange-800 uppercase tracking-widest animate-pulse">Consulting Guides...</div>}
        </main>

        <footer className="p-4 md:p-8 bg-white border-t border-orange-100 shrink-0">
          <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-4">
            <input 
              type="text" 
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={envKeyExists ? "Ask Fuzzy anything..." : "⚠️ API KEY MISSING"}
              className={`flex-1 bg-slate-50 border-2 rounded-[2rem] px-8 py-5 focus:outline-none focus:border-orange-600 focus:bg-white font-semibold transition-all shadow-inner ${!envKeyExists ? 'border-red-200 placeholder-red-400' : 'border-slate-100'}`}
              disabled={isTyping}
            />
            <button type="submit" disabled={!inputValue.trim() || isTyping} className="w-16 h-16 bg-orange-700 text-white rounded-3xl font-bold hover:bg-orange-800 shadow-2xl flex items-center justify-center active:scale-90 transition-all">
              <i className="fa-solid fa-paper-plane text-xl"></i>
            </button>
          </form>
        </footer>
      </div>

      <aside className="hidden xl:flex w-[420px] flex-col bg-white border-l border-orange-50 p-12 overflow-y-auto shrink-0">
        <h2 className="text-4xl font-black mb-10 tracking-tighter">Stay Brief</h2>
        <div className="space-y-8">
          <MicTester />
          
          <div className="glass p-6 rounded-[2rem] border border-orange-100 shadow-sm space-y-4">
             <h3 className="text-[10px] font-black uppercase text-orange-900/60 tracking-widest">System Check</h3>
             <button 
              onClick={verifyConnection}
              disabled={isVerifying || !envKeyExists}
              className="w-full py-3 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all flex items-center justify-center gap-2 disabled:opacity-50"
             >
               {isVerifying ? <i className="fa-solid fa-spinner animate-spin"></i> : <i className="fa-solid fa-bolt"></i>}
               Verify Connection
             </button>
          </div>

          <InfoCard title="Wi-Fi" icon="fa-wifi" value={CABIN_DETAILS.wifiName} description={CABIN_DETAILS.wifiPass} />
          <div className="grid grid-cols-2 gap-5">
            <InfoCard title="In" icon="fa-clock" value={CABIN_DETAILS.checkIn} />
            <InfoCard title="Out" icon="fa-door-open" value={CABIN_DETAILS.checkOut} />
          </div>
          
          <div className="mt-12 pt-10 border-t border-slate-100">
            <h3 className="text-[10px] font-black uppercase text-slate-400 mb-8 tracking-widest">Guest Rules</h3>
            <ul className="space-y-5">
              {CABIN_DETAILS.rules.map((rule, i) => (
                <li key={i} className="flex items-start gap-5 text-sm text-slate-600 font-bold leading-relaxed">
                  <div className="w-6 h-6 bg-orange-50 rounded-lg flex items-center justify-center shrink-0 mt-0.5"><i className="fa-solid fa-check text-[10px] text-orange-600"></i></div>
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
