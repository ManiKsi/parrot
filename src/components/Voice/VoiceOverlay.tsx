import React, { useCallback, useEffect, useRef, useState } from 'react'

interface VoiceState {
  mode: 'idle' | 'listening' | 'processing'
  phaseMsg?: string
  question?: string
  answer?: string
  error?: string
  model?: string
  requestId?: string
}

interface HistoryTurn { q: string; a: string; ts: number }

const formatTime = (ms: number) => {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}:${sec.toString().padStart(2,'0')}` : `${sec}s`
}

const VoiceOverlay: React.FC = () => {
  const [state, setState] = useState<VoiceState>({ mode: 'idle' })
  // User-visible panel flag: only becomes true once user starts voice interaction
  const [showPanel, setShowPanel] = useState(false)
  const [context, setContext] = useState('')
  const [contextDirty, setContextDirty] = useState(false)
  const [model, setModel] = useState<string>('')
  const [modelSaving, setModelSaving] = useState(false)
  const [historyEnabled, setHistoryEnabled] = useState(true)
  const [history, setHistory] = useState<HistoryTurn[]>([])
  const saveTimeoutRef = useRef<number | null>(null)
  const currentRequestIdRef = useRef<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTsRef = useRef<number>(0)
  const timerRef = useRef<number | null>(null)

  const clearTimer = () => { if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null } }

  const startTimer = () => {
    clearTimer()
    startTsRef.current = Date.now()
    timerRef.current = window.setInterval(() => {
      setElapsed(Date.now() - startTsRef.current)
    }, 200)
  }

  const stopTimer = () => clearTimer()

  const startRecording = useCallback(async () => {
    if (state.mode !== 'idle') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stopTimer()
        setState(s => ({ ...s, mode: 'processing', phaseMsg: 'Uploading audio…' }))
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        // Convert to PCM WAV quickly (simplistic) - rely on server if supports webm; else implement WAV conversion later
        const buffer = await blob.arrayBuffer()
        await (window as any).electronAPI.voice.submitRecording(buffer)
      }
      mediaRecorderRef.current = mr
      mr.start()
      startTimer()
      setState({ mode: 'listening' })
    } catch (e: any) {
      setState({ mode: 'idle', error: e?.message || 'Microphone access denied' })
    }
  }, [state.mode])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.mode === 'listening') {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
    }
  }, [state.mode])

  // Toggle from global shortcut
  useEffect(() => {
    const off = (window as any).electronAPI.voice.onToggle(() => {
      // First interaction toggles panel visible
      setShowPanel(true)
      setState(prev => {
        if (prev.mode === 'idle') {
          startRecording()
          return prev
        } else if (prev.mode === 'listening') {
          stopRecording()
          return prev
        }
        return prev
      })
    })
    return () => { off && off() }
  }, [startRecording, stopRecording])

  // Status updates
  useEffect(() => {
    const offStatus = (window as any).electronAPI.voice.onStatus((s: any) => {
      // Ignore legacy reset status if ever emitted
      if (s.phase === 'reset') return
      setState(prev => ({ ...prev, phaseMsg: s.message, mode: 'processing', question: s.question || prev.question, requestId: s.requestId || prev.requestId }))
      if (s.requestId) currentRequestIdRef.current = s.requestId
      setShowPanel(true)
    })
    const offResult = (window as any).electronAPI.voice.onResult((r: any) => {
      setState({ mode: 'idle', question: r.question, answer: r.answer, model: r.model, requestId: r.requestId })
      setShowPanel(true)
      // Refresh history list after completion
      ;(async () => {
        try {
          const hist = await (window as any).electronAPI.voice.getHistory()
          if (hist?.history) setHistory(hist.history)
          currentRequestIdRef.current = null
        } catch {}
      })()
    })
    const offPartial = (window as any).electronAPI.voice.onPartial((p: any) => {
      setState(prev => {
        // If a new request starts while still processing old, reset
        if (prev.requestId && p.requestId && p.requestId !== prev.requestId) {
          return { mode: 'processing', question: prev.question, answer: p.answer, phaseMsg: 'Generating…', model: p.model, requestId: p.requestId }
        }
        return { ...prev, answer: p.answer, model: p.model, requestId: p.requestId, mode: 'processing' }
      })
    })
    const offError = (window as any).electronAPI.voice.onError((err: string) => {
      setState({ mode: 'idle', error: err })
    })
    return () => { offStatus && offStatus(); offResult && offResult(); offPartial && offPartial(); offError && offError() }
  }, [])

  // Listen for global reset to clear local voice UI state
  useEffect(() => {
    const remove = (window as any).electronAPI.onReset?.(() => {
      // Clear all UI-affecting state so overlay hides
      setState({ mode: 'idle', question: '', answer: '' })
      setHistory([])
      // Preserve context per user request
      setModel('')
      setElapsed(0)
      currentRequestIdRef.current = null
      setShowPanel(false)
    })
    return () => { remove && remove() }
  }, [])

  // Listen for dedicated voice reset event
  useEffect(() => {
    const off = (window as any).electronAPI.voice.onReset?.(() => {
      setState({ mode: 'idle' })
      setHistory([])
      setContext('')
      setModel('')
      setElapsed(0)
      currentRequestIdRef.current = null
      setShowPanel(false)
    })
    return () => { off && off() }
  }, [])

  // Load existing context on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await (window as any).electronAPI.voice.getContext()
        if (res?.context) setContext(res.context)
        const mr = await (window as any).electronAPI.voice.getModel()
        if (mr?.model) setModel(mr.model)
        const he = await (window as any).electronAPI.voice.getHistoryEnabled()
        if (typeof he?.enabled === 'boolean') setHistoryEnabled(he.enabled)
        const hist = await (window as any).electronAPI.voice.getHistory()
        if (hist?.history) setHistory(hist.history)
      } catch {}
    })()
  }, [])

  // Debounced auto-save of context
  useEffect(() => {
    if (!contextDirty) return
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        await (window as any).electronAPI.voice.setContext(context)
        setContextDirty(false)
      } catch {}
    }, 800)
  }, [context, contextDirty])

  // Keyboard ESC to cancel during listening
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state.mode === 'listening') {
        stopRecording()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [state.mode, stopRecording])

  const indicator = state.mode === 'listening'
    ? 'Listening… press shortcut again or ESC to stop'
    : state.mode === 'processing' ? (state.phaseMsg || 'Processing…') : null

  // Hide overlay during screenshot capture events
  const [hiddenForCapture, setHiddenForCapture] = useState(false)
  useEffect(() => {
    const offPrep = (window as any).electronAPI?.onCapturePrepare?.(() => setHiddenForCapture(true))
    const offRestore = (window as any).electronAPI?.onCaptureRestore?.(() => setHiddenForCapture(false))
    return () => { offPrep && offPrep(); offRestore && offRestore() }
  }, [])

  // Visibility logic: only show overlay when active (listening/processing) or user has at least one Q/A in history
  const hasConversation = history.length > 0 || state.question || state.answer
  const shouldShow = showPanel && (state.mode !== 'idle' || hasConversation)
  return shouldShow ? (
    <div id="voice-overlay" data-hidden={hiddenForCapture ? '1' : '0'} className={`fixed bottom-4 right-4 w-96 max-h-[80vh] overflow-hidden flex flex-col rounded-lg bg-zinc-900/90 backdrop-blur-sm text-white text-xs p-3 space-y-2 z-[9999] border border-zinc-700/60 shadow-lg transition-opacity duration-75 ${hiddenForCapture ? 'opacity-0 pointer-events-none select-none' : 'opacity-100'}`}> 
      <div className="flex items-center justify-between">
        <span className="font-semibold tracking-wide">Voice Q&A</span>
  <span className="px-1.5 py-0.5 rounded bg-zinc-700/60 text-[10px]">Ctrl/Cmd+M</span>
      </div>
      {indicator && (
        <div className="text-amber-300 text-[11px] flex items-center gap-2">
          <span className={state.mode === 'listening' ? 'animate-pulse' : ''}>{indicator}</span>
          {state.mode === 'listening' && <span className="text-amber-400/80">{formatTime(elapsed)}</span>}
        </div>
      )}
      {state.error && (
        <div className="text-red-400/90">
          Error: {state.error}
          <button className="ml-2 underline" onClick={() => setState({ mode: 'idle' })}>clear</button>
        </div>
      )}
      <div className="space-y-1">
        <div className="text-[11px] text-zinc-400 uppercase tracking-wide">Conversation</div>
        <div className="max-h-44 overflow-auto flex flex-col gap-2 pr-1 custom-scrollbar">
          {history.length === 0 && state.question && state.answer === undefined && (
            <div className="text-zinc-500 text-[11px]">First question in progress…</div>
          )}
          {history.map(turn => (
            <div key={turn.ts} className="space-y-1">
              <div className="bg-zinc-800/60 rounded p-2 text-[11px]">
                <span className="text-amber-300 font-semibold mr-1">You:</span>
                <span className="text-zinc-200 whitespace-pre-wrap">{turn.q}</span>
              </div>
              <div className="bg-zinc-700/50 rounded p-2 text-[11px]">
                <span className="text-green-300 font-semibold mr-1">AI:</span>
                <span className="text-zinc-100 whitespace-pre-wrap">{turn.a}</span>
              </div>
            </div>
          ))}
          {state.mode === 'processing' && state.question && (
            <div className="space-y-1 opacity-90">
              <div className="bg-zinc-800/60 rounded p-2 text-[11px]">
                <span className="text-amber-300 font-semibold mr-1">You:</span>
                <span className="text-zinc-200 whitespace-pre-wrap">{state.question}</span>
              </div>
              <div className="bg-zinc-700/50 rounded p-2 text-[11px] animate-pulse">
                <span className="text-green-300 font-semibold mr-1">AI:</span>
                <span className="text-zinc-100 whitespace-pre-wrap">{state.answer || '…'}</span>
              </div>
            </div>
          )}
        </div>
        {state.model && state.mode === 'idle' && state.answer && (
          <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Model: {state.model}</div>
        )}
      </div>
      <div className="space-y-1">
        <details className="group">
          <summary className="cursor-pointer text-[11px] text-zinc-400 group-open:text-zinc-200 select-none">History Settings</summary>
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <label className="flex items-center gap-1 select-none">
              <input
                type="checkbox"
                checked={historyEnabled}
                onChange={async e => {
                  const en = e.target.checked
                  setHistoryEnabled(en)
                  try { await (window as any).electronAPI.voice.setHistoryEnabled(en) } catch {}
                }}
              /> Enabled
            </label>
            <button
              className="px-2 py-0.5 bg-zinc-700/60 rounded hover:bg-zinc-600/70 disabled:opacity-50"
              disabled={!history.length}
              onClick={async () => {
                try { await (window as any).electronAPI.voice.clearHistory(); setHistory([]) } catch {}
              }}
            >Clear All</button>
            <div className="text-[10px] text-zinc-500">Turns: {history.length}</div>
          </div>
        </details>
        <details className="group">
          <summary className="cursor-pointer text-[11px] text-zinc-400 group-open:text-zinc-200 select-none">Model (on the fly)</summary>
          <div className="mt-1 flex items-center gap-2">
            <input
              className="flex-1 bg-zinc-800/60 border border-zinc-700/50 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400/60"
              placeholder="e.g. phi3:latest"
              value={model}
              onChange={e => setModel(e.target.value)}
            />
            <button
              className="px-2 py-1 bg-amber-600/80 hover:bg-amber-500 text-[11px] rounded disabled:opacity-50"
              disabled={!model || modelSaving}
              onClick={async () => {
                setModelSaving(true)
                try {
                  await (window as any).electronAPI.voice.setModel(model)
                } finally { setModelSaving(false) }
              }}
            >{modelSaving ? 'Saving…' : 'Apply'}</button>
          </div>
          <div className="mt-1 text-[10px] text-zinc-500 leading-snug">If set, this model is tried first before fallbacks (phi3, mistral, llama3, gemma).</div>
        </details>
        <details className="group">
          <summary className="cursor-pointer text-[11px] text-zinc-400 group-open:text-zinc-200 select-none">Context (influences answers)</summary>
          <textarea
            className="mt-1 w-full h-16 bg-zinc-800/60 border border-zinc-700/50 rounded p-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-400/60 resize-y"
            value={context}
            placeholder="e.g. You are an AWS interviewer focusing on scalability and cost optimization."
            onChange={e => { setContext(e.target.value); setContextDirty(true) }}
          />
          {contextDirty && <div className="text-[10px] text-amber-400/80">Saving…</div>}
        </details>
      </div>
      {state.mode === 'idle' && !state.question && !state.error && (
        <div className="text-zinc-400 text-[11px]">Press shortcut to start recording a question.</div>
      )}
    </div>
  ) : null
}

export default VoiceOverlay
