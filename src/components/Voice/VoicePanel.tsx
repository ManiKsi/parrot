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

/**
 * Inline (larger) Voice Q&A panel rendered inside Queue page below commands.
 * Reuses event logic from overlay but with a full-width adaptive layout.
 */
const VoicePanel: React.FC = () => {
  // Central settings dialog now owns model/history/context; hide inline duplicates unless enabled for debugging.
  const SHOW_ADVANCED_INLINE_SETTINGS = false
  const [state, setState] = useState<VoiceState>({ mode: 'idle' })
  const [context, setContext] = useState('')
  const [contextDirty, setContextDirty] = useState(false)
  const [model, setModel] = useState<string>('')
  const [modelSaving, setModelSaving] = useState(false)
  const [historyEnabled, setHistoryEnabled] = useState(true)
  const [history, setHistory] = useState<HistoryTurn[]>([])
  // Microphone / input settings now presented as a dropdown menu instead of inline sidebar
  const [micMenuOpen, setMicMenuOpen] = useState(false)
  const micMenuRef = useRef<HTMLDivElement | null>(null)
  const [inputMode, setInputMode] = useState<'mic' | 'system' | 'mixed'>('mic')
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string>('')
  const [desktopSources, setDesktopSources] = useState<{ id: string; name: string }[]>([])
  const [selectedDesktopSourceId, setSelectedDesktopSourceId] = useState<string>('')
  const saveTimeoutRef = useRef<number | null>(null)
  const currentRequestIdRef = useRef<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTsRef = useRef<number>(0)
  const timerRef = useRef<number | null>(null)
  const [hiddenForCapture, setHiddenForCapture] = useState(false)
  const conversationRef = useRef<HTMLDivElement | null>(null)
  // Auto-scroll management
  const [autoScrollPinned, setAutoScrollPinned] = useState(true)
  // Audio level meter state & refs
  const [micLevel, setMicLevel] = useState(0)
  const [systemLevel, setSystemLevel] = useState(0)
  const [meterGain, setMeterGain] = useState<number>(1.0)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserMicRef = useRef<AnalyserNode | null>(null)
  const analyserSysRef = useRef<AnalyserNode | null>(null)
  const levelRafRef = useRef<number | null>(null)
  const micSmoothRef = useRef(0)
  const sysSmoothRef = useRef(0)
  const meterGainRef = useRef(1.0)
  // Debug level logging
  const DEBUG_METERS = (import.meta as any).env?.DEV ?? true
  const lastLogRef = useRef<number>(0)
  const [debugMic, setDebugMic] = useState(0)
  const [debugSys, setDebugSys] = useState(0)
  const [debugInfo, setDebugInfo] = useState<string>('')
  const [systemWarning, setSystemWarning] = useState<string>('')
  const [systemCaptureMethod, setSystemCaptureMethod] = useState<string>('')
  const [systemDebug, setSystemDebug] = useState<string>('')
  const [permDiagnostics, setPermDiagnostics] = useState<string>('')

  // Persist / sync meter gain
  useEffect(() => {
    try {
      const stored = localStorage.getItem('voice.meterGain')
      if (stored) {
        const v = parseFloat(stored)
        if (!Number.isNaN(v) && v >= 0.5 && v <= 2.5) {
          setMeterGain(v)
          meterGainRef.current = v
        }
      }
    } catch {}
  }, [])
  useEffect(() => {
    meterGainRef.current = meterGain
    try { localStorage.setItem('voice.meterGain', String(meterGain)) } catch {}
  }, [meterGain])

  const cleanupAudioContext = () => {
    if (levelRafRef.current) { cancelAnimationFrame(levelRafRef.current); levelRafRef.current = null }
    analyserMicRef.current = null
    analyserSysRef.current = null
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close() } catch {}
      audioCtxRef.current = null
    }
    setMicLevel(0); setSystemLevel(0)
  }

  const clearTimer = () => { if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null } }
  const startTimer = () => {
    clearTimer();
    startTsRef.current = Date.now();
    timerRef.current = window.setInterval(() => setElapsed(Date.now() - startTsRef.current), 200)
  }
  const stopTimer = () => clearTimer()

  const startRecording = useCallback(async () => {
    if (state.mode !== 'idle') return
    try {
      cleanupAudioContext()
      let finalStream: MediaStream | null = null
      let micStreamLocal: MediaStream | null = null
      let sysStreamLocal: MediaStream | null = null

      // Helper: obtain system (desktop) audio stream safely. Some Electron / Chromium builds
      // crash (bad IPC 263) if only audio is requested with video:false. Request a tiny video
      // track then immediately stop/remove it, keeping only audio tracks.
      const getSystemAudioStream = async (sourceId: string): Promise<MediaStream> => {
        // Helper to very quickly measure if stream has non-trivial audio (RMS > threshold)
        const checkSilence = async (stream: MediaStream, label: string): Promise<{silent: boolean; rms: number}> => {
          try {
            const ctx = new AudioContext()
            const src = ctx.createMediaStreamSource(stream)
            const analyser = ctx.createAnalyser()
            analyser.fftSize = 1024
            src.connect(analyser)
            await new Promise(r => setTimeout(r, 250)) // allow buffer fill
            const buf = new Float32Array(analyser.fftSize)
            if ((analyser as any).getFloatTimeDomainData) (analyser as any).getFloatTimeDomainData(buf)
            else {
              const bytes = new Uint8Array(analyser.fftSize)
              analyser.getByteTimeDomainData(bytes)
              for (let i=0;i<bytes.length;i++) buf[i] = (bytes[i]-128)/128
            }
            let sum = 0
            for (let i=0;i<buf.length;i++) sum += buf[i]*buf[i]
            const rms = Math.sqrt(sum / buf.length)
            ctx.close().catch(()=>{})
            const silent = rms < 0.0008
            if (DEBUG_METERS) console.log('[VoicePanel][SystemAudio][Probe]', label, { rms, silent })
            return { silent, rms }
          } catch (e) {
            return { silent: false, rms: -1 }
          }
        }

        // Primary method: legacy chromeMediaSource via getUserMedia
        const desktopConstraints: any = {
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId,
              maxWidth: 16,
              maxHeight: 16,
              maxFrameRate: 1
            }
          }
        }
        try {
          const full = await (navigator.mediaDevices as any).getUserMedia(desktopConstraints)
          full.getVideoTracks().forEach((t: MediaStreamTrack) => { t.stop(); full.removeTrack(t) })
          const audioTracks = full.getAudioTracks()
          if (!audioTracks.length) throw new Error('No audio tracks from legacy desktop capture')
          const probe = await checkSilence(full, 'legacy')
          if (!probe.silent) {
            setSystemCaptureMethod('legacy-desktop')
            setSystemDebug(`legacy rms=${probe.rms.toFixed(5)}`)
            return new MediaStream(audioTracks)
          } else {
            if (DEBUG_METERS) console.warn('[VoicePanel] Legacy desktop stream appears silent; attempting displayMedia fallback.')
            full.getAudioTracks().forEach((t: MediaStreamTrack) => t.stop())
          }
        } catch (e:any) {
          if (DEBUG_METERS) console.warn('[VoicePanel] Legacy desktop capture failed:', e?.message || e)
        }

        // Fallback: getDisplayMedia (some Electron/Chromium versions expose system audio here)
        try {
          const disp: any = await (navigator.mediaDevices as any).getDisplayMedia({
            audio: true,
            video: { width:16, height:16, frameRate:1 }
          })
          disp.getVideoTracks().forEach((t: MediaStreamTrack) => { t.stop(); disp.removeTrack(t) })
          const audioTracks = disp.getAudioTracks()
          if (!audioTracks.length) throw new Error('No audio tracks from displayMedia')
          const probe = await checkSilence(disp, 'displayMedia')
            if (!probe.silent) {
              setSystemCaptureMethod('display-media')
              setSystemDebug(`displayMedia rms=${probe.rms.toFixed(5)}`)
              return new MediaStream(audioTracks)
            } else {
              setSystemDebug(`silent (legacy + displayMedia). rms=${probe.rms.toFixed(5)}`)
              throw new Error('System audio stream appears silent. On macOS true system output capture is not provided natively; configure a loopback device (e.g. BlackHole) and select it as microphone or route output to it.')
            }
        } catch (e:any) {
          setSystemDebug(prev => prev ? prev + ' | displayMedia fail: ' + (e?.message||e) : 'displayMedia fail: ' + (e?.message||e))
          throw e
        }
      }

      if (inputMode === 'mic') {
        const constraints: MediaStreamConstraints = { audio: selectedMicId ? { deviceId: { exact: selectedMicId } } : true }
        finalStream = await navigator.mediaDevices.getUserMedia(constraints)
        micStreamLocal = finalStream
      } else if (inputMode === 'system') {
        if (!selectedDesktopSourceId) throw new Error('Select a system source first')
        try {
          const sysStream = await getSystemAudioStream(selectedDesktopSourceId)
          finalStream = sysStream
          sysStreamLocal = sysStream
          if (DEBUG_METERS) {
            const tracks = sysStream.getAudioTracks()
            console.log('[VoicePanel] system mode acquired audio tracks:', tracks.map(t => ({ id: t.id, label: (t as any).label, settings: t.getSettings?.() })), 'method=', systemCaptureMethod)
          }
        } catch (err: any) {
          console.error('[VoicePanel] system capture failed primary path:', err)
          throw new Error('Failed to capture system audio. On macOS you may need a loopback device (e.g. BlackHole) or grant screen recording permissions in System Settings > Privacy & Security > Screen Recording.')
        }
      } else if (inputMode === 'mixed') {
        if (!selectedDesktopSourceId) throw new Error('Select a system source first')
        micStreamLocal = await navigator.mediaDevices.getUserMedia(selectedMicId ? { audio: { deviceId: { exact: selectedMicId } } } : { audio: true })
        try {
          sysStreamLocal = await getSystemAudioStream(selectedDesktopSourceId)
        } catch (err: any) {
          console.error('[VoicePanel] mixed mode system capture failed:', err)
          // Continue with mic only if system audio fails, but note in error string in UI
          setSystemWarning('System audio unavailable; continuing with microphone only.')
          sysStreamLocal = null
        }
        const audioCtx = new AudioContext()
        audioCtxRef.current = audioCtx
        const dest = audioCtx.createMediaStreamDestination()
        const patch = (s: MediaStream) => {
          s.getAudioTracks().forEach(t => {
            const src = audioCtx.createMediaStreamSource(new MediaStream([t]))
            src.connect(dest)
          })
        }
  if (micStreamLocal) patch(micStreamLocal)
        if (sysStreamLocal) patch(sysStreamLocal)
        finalStream = dest.stream
      }

      if (!finalStream) throw new Error('Could not acquire audio stream')

      // Expose stream for runtime debugging (dev only)
      try {
        if (DEBUG_METERS) {
          ;(window as any).__voiceDebug = { stream: finalStream, inputMode, mic: micStreamLocal, system: sysStreamLocal }
        }
      } catch {}

  // Transition to listening state before starting the animation loop so closure checks won't miss it
  setState({ mode: 'listening' })

      // Setup analysers for VU meters
      const ensureCtx = () => {
        if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
        // Resume in case autoplay policy suspended it
        if (audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume().catch(() => {})
        }
        return audioCtxRef.current
      }
      const setupAnalyser = (stream: MediaStream, kind: 'mic' | 'system') => {
        try {
          const ctx = ensureCtx()
            // Use the first audio track of the provided stream
          const src = ctx.createMediaStreamSource(stream)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 2048
          src.connect(analyser)
          if (kind === 'mic') analyserMicRef.current = analyser
          else analyserSysRef.current = analyser
        } catch {}
      }
      if (micStreamLocal && (inputMode === 'mic' || inputMode === 'mixed')) setupAnalyser(micStreamLocal, 'mic')
      if (sysStreamLocal && (inputMode === 'system' || inputMode === 'mixed')) setupAnalyser(sysStreamLocal, 'system')

      const updateLevels = () => {
  let updatedMic: number | null = null as number | null
  let updatedSys: number | null = null as number | null
        const sample = (analyser: AnalyserNode | null, smoothRef: React.MutableRefObject<number>, setter: (v: number) => void, kind: 'mic'|'sys') => {
          if (!analyser) return
          const bufferLength = analyser.fftSize
          const floatData = new Float32Array(bufferLength)
          if ((analyser as any).getFloatTimeDomainData) (analyser as any).getFloatTimeDomainData(floatData)
          else {
            const byteData = new Uint8Array(bufferLength)
            analyser.getByteTimeDomainData(byteData)
            for (let i = 0; i < bufferLength; i++) floatData[i] = (byteData[i] - 128) / 128
          }
          let sum = 0
          let peak = 0
            // Compute RMS & peak
          for (let i = 0; i < bufferLength; i++) {
            const v = floatData[i]
            sum += v * v
            const av = Math.abs(v)
            if (av > peak) peak = av
          }
          let rms = Math.sqrt(sum / bufferLength)
      // Blend peak & rms (slightly favor RMS for stability)
      let level = (rms * 0.75) + (peak * 0.25)
      // Perceptual curve + user gain
      level = Math.pow(level, 1.05) * 1.4 * meterGainRef.current
      // Adaptive noise gate (much lower) while retaining micro movement
      const noiseGate = 0.002 * meterGainRef.current
      if (level < noiseGate) level = 0
      else level = (level - noiseGate) / (1 - noiseGate)
          // Smoothing (attack fast, release slower)
          const prev = smoothRef.current
          const attack = 0.5
      // Additional diagnostics (mic only)
      if (DEBUG_METERS && kind === 'mic') {
        // Compute simple variance for raw data (already have floatData)
        let mean = 0
        for (let i = 0; i < bufferLength; i++) mean += floatData[i]
        mean /= bufferLength
        let varSum = 0
        for (let i = 0; i < bufferLength; i++) { const d = floatData[i] - mean; varSum += d * d }
        const variance = varSum / bufferLength
        setDebugInfo(`ctx=${audioCtxRef.current?.state || 'n/a'} rms=${rms.toFixed(4)} pk=${peak.toFixed(4)} var=${variance.toFixed(5)} rawLvl=${level.toFixed(4)}`)
      }
          const release = 0.1
          if (level > prev) smoothRef.current = prev + (level - prev) * attack
          else smoothRef.current = prev + (level - prev) * release
          const out = Math.min(1, Math.max(0, smoothRef.current))
          setter(out)
          if (kind === 'mic') updatedMic = out; else updatedSys = out
        }
        sample(analyserMicRef.current, micSmoothRef, setMicLevel, 'mic')
        sample(analyserSysRef.current, sysSmoothRef, setSystemLevel, 'sys')

        if (DEBUG_METERS) {
          const now = performance.now()
            // Throttle logs every 500ms
          if (now - lastLogRef.current > 500) {
            lastLogRef.current = now
            if (updatedMic !== null) setDebugMic(updatedMic)
            if (updatedSys !== null) setDebugSys(updatedSys)
            if (updatedMic !== null || updatedSys !== null) {
              // eslint-disable-next-line no-console
              console.log('[VoicePanel][VU]', {
                mic: updatedMic !== null ? updatedMic.toFixed(3) : '—',
                system: updatedSys !== null ? updatedSys.toFixed(3) : '—'
              })
            }
          }
        }
        if (analyserMicRef.current || analyserSysRef.current) levelRafRef.current = requestAnimationFrame(updateLevels)
      }

      const mr = new MediaRecorder(finalStream)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = async () => {
        stopTimer()
        cleanupAudioContext()
        setState(s => ({ ...s, mode: 'processing', phaseMsg: 'Uploading audio…' }))
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const buffer = await blob.arrayBuffer()
        await (window as any).electronAPI.voice.submitRecording(buffer)
      }
      mediaRecorderRef.current = mr
      mr.start()
      startTimer()
      // Start meter loop only after recorder actually started
      levelRafRef.current = requestAnimationFrame(updateLevels)
    } catch (e: any) {
      cleanupAudioContext()
      setState({ mode: 'idle', error: e?.message || 'Microphone/system audio access denied' })
    }
  }, [state.mode, inputMode, selectedMicId, selectedDesktopSourceId])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.mode === 'listening') {
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop())
    }
  }, [state.mode])

  // Abort current processing (LLM/STT) if in processing mode
  const abortProcessing = useCallback(async () => {
    if (state.mode !== 'processing') return
    try {
      await (window as any).electronAPI.voice.abortProcessing?.()
    } catch {}
    setState({ mode: 'idle' })
  }, [state.mode])

  // Capture hide events
  useEffect(() => {
    const offPrep = (window as any).electronAPI?.onCapturePrepare?.(() => setHiddenForCapture(true))
    const offRestore = (window as any).electronAPI?.onCaptureRestore?.(() => setHiddenForCapture(false))
    return () => { offPrep && offPrep(); offRestore && offRestore() }
  }, [])

  // Global shortcut toggle
  useEffect(() => {
    const off = (window as any).electronAPI.voice.onToggle(() => {
      setState(prev => {
        if (prev.mode === 'idle') { startRecording(); return prev }
        else if (prev.mode === 'listening') { stopRecording(); return prev }
        return prev
      })
    })
    return () => { off && off() }
  }, [startRecording, stopRecording])

  // Voice status events
  useEffect(() => {
    const api = (window as any).electronAPI.voice
    const offStatus = api.onStatus((s: any) => {
      setState(prev => ({ ...prev, phaseMsg: s.message, mode: 'processing', question: s.question || prev.question, requestId: s.requestId || prev.requestId }))
      if (s.requestId) currentRequestIdRef.current = s.requestId
    })
    const offResult = api.onResult((r: any) => {
      setState({ mode: 'idle', question: r.question, answer: r.answer, model: r.model, requestId: r.requestId })
      ;(async () => { try { const hist = await api.getHistory(); if (hist?.history) setHistory(hist.history) } catch {} })()
      currentRequestIdRef.current = null
    })
    const offPartial = api.onPartial((p: any) => {
      setState(prev => {
        if (prev.requestId && p.requestId && p.requestId !== prev.requestId) {
          return { mode: 'processing', question: prev.question, answer: p.answer, phaseMsg: 'Generating…', model: p.model, requestId: p.requestId }
        }
        return { ...prev, answer: p.answer, model: p.model, requestId: p.requestId, mode: 'processing' }
      })
    })
    const offError = api.onError((err: string) => {
      setState({ mode: 'idle', error: err })
    })
    const offAborted = api.onAborted((data?: any) => {
      // Clear transient streaming state on abort
      setState({ mode: 'idle', question: state.question, answer: undefined, requestId: undefined })
      currentRequestIdRef.current = null
    })
    return () => { offStatus && offStatus(); offResult && offResult(); offPartial && offPartial(); offError && offError(); offAborted && offAborted() }
  }, [])

  // Load persisted context/model/history
  useEffect(() => {
    (async () => {
      try {
        const api = (window as any).electronAPI.voice
        const res = await api.getContext(); if (res?.context) setContext(res.context)
        const mr = await api.getModel(); if (mr?.model) setModel(mr.model)
        const he = await api.getHistoryEnabled(); if (typeof he?.enabled === 'boolean') setHistoryEnabled(he.enabled)
        const hist = await api.getHistory(); if (hist?.history) setHistory(hist.history)
      } catch {}
    })()
  }, [])

  // Listen for external settings updates dispatched from SettingsDialog
  useEffect(() => {
    const handler = (e: Event) => {
      const detail: any = (e as CustomEvent).detail || {}
      if (typeof detail.model === 'string') setModel(detail.model)
      if (typeof detail.context === 'string') setContext(detail.context)
      if (typeof detail.historyEnabled === 'boolean') setHistoryEnabled(detail.historyEnabled)
      if (detail.historyCleared) setHistory([])
    }
    window.addEventListener('voice-settings-updated', handler as EventListener)
    return () => window.removeEventListener('voice-settings-updated', handler as EventListener)
  }, [])

  // Listen for input source quick menu updates from QueueCommands
  useEffect(() => {
    const handler = (e: Event) => {
      const detail: any = (e as CustomEvent).detail || {}
      if (detail.inputMode && ['mic','system','mixed'].includes(detail.inputMode)) {
        setInputMode(detail.inputMode)
      }
      if (typeof detail.micId === 'string') setSelectedMicId(detail.micId)
      if (typeof detail.desktopSourceId === 'string') setSelectedDesktopSourceId(detail.desktopSourceId)
      if (typeof detail.meterGain === 'number') {
        setMeterGain(detail.meterGain)
      }
    }
    window.addEventListener('voice-input-settings-updated', handler as EventListener)
    return () => window.removeEventListener('voice-input-settings-updated', handler as EventListener)
  }, [])

  // Broadcast local input settings changes for cross-component sync
  const dispatchInputSettings = useCallback((next?: Partial<{ inputMode: string; micId: string; desktopSourceId: string; meterGain: number }>) => {
    const detail = {
      inputMode,
      micId: selectedMicId,
      desktopSourceId: selectedDesktopSourceId,
      meterGain,
      ...(next || {})
    }
    window.dispatchEvent(new CustomEvent('voice-input-settings-updated', { detail }))
  }, [inputMode, selectedMicId, selectedDesktopSourceId, meterGain])

  // Enumerate audio input devices (microphones) & desktop sources when menu opens or if defaults missing
  useEffect(() => {
    if (!micMenuOpen && selectedMicId && selectedDesktopSourceId) return
    const enumerate = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const mics = devices.filter(d => d.kind === 'audioinput')
        setAvailableMics(mics)
        if (!selectedMicId && mics.length) {
          setSelectedMicId(mics[0].deviceId)
          dispatchInputSettings({ micId: mics[0].deviceId })
        }
      } catch {}
      try {
        const res = await (window as any).electronAPI.getDesktopAudioSources()
        if (res?.success && res.sources) {
          setDesktopSources(res.sources)
          if (!selectedDesktopSourceId && res.sources.length) {
            setSelectedDesktopSourceId(res.sources[0].id)
            dispatchInputSettings({ desktopSourceId: res.sources[0].id })
          }
        }
      } catch {}
    }
    enumerate()
  }, [micMenuOpen, selectedMicId, selectedDesktopSourceId, dispatchInputSettings])

  // Outside click to close mic menu
  useEffect(() => {
    if (!micMenuOpen) return
    const handle = (e: MouseEvent) => {
      if (!micMenuRef.current) return
      if (micMenuRef.current.contains(e.target as Node)) return
      setMicMenuOpen(false)
    }
    window.addEventListener('mousedown', handle)
    return () => window.removeEventListener('mousedown', handle)
  }, [micMenuOpen])

  // Debounced context save
  useEffect(() => {
    if (!contextDirty) return
    if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current)
    saveTimeoutRef.current = window.setTimeout(async () => {
      try { await (window as any).electronAPI.voice.setContext(context); setContextDirty(false) } catch {}
    }, 800)
  }, [context, contextDirty])

  // ESC to cancel listening
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && state.mode === 'listening') stopRecording() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [state.mode, stopRecording])

  const indicator = state.mode === 'listening'
    ? 'Listening… press shortcut again or ESC to stop'
    : state.mode === 'processing' ? (state.phaseMsg || 'Processing…') : null

  // Auto-scroll conversation on new partials / results
  useEffect(() => {
    const el = conversationRef.current
    if (!el) return
    if (!autoScrollPinned) return
    // During streaming (processing mode) use immediate jump to avoid rubber-banding
    if (state.mode === 'processing') {
      el.scrollTop = el.scrollHeight
    } else {
      // On final result allow smooth scroll once
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [state.answer, state.mode, history.length, autoScrollPinned])

  // Track user manual scrolling to disable auto pin until they return near bottom
  useEffect(() => {
    const el = conversationRef.current
    if (!el) return
    const handleScroll = () => {
      const atBottom = (el.scrollHeight - (el.scrollTop + el.clientHeight)) < 32
      setAutoScrollPinned(atBottom)
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  // (Settings remain visible across resets to allow pre-configuration.)

  // React to full application reset (screenshots/problem/voice) so panel hides
  useEffect(() => {
    const off = (window as any).electronAPI.onReset?.(() => {
      // Clear all local state so visibility logic returns false
      setState({ mode: 'idle' })
      setHistory([])
      // Preserve context per user request
      setModel('')
      setElapsed(0)
      currentRequestIdRef.current = null
      cleanupAudioContext()
    })
    return () => { off && off() }
  }, [])

  // Only show panel when user is actively in voice mode or has any conversation history
  // Always show panel so user can configure settings BEFORE first use.
  const hasConversation = history.length > 0 || state.question || state.answer

  // Detect prolonged silence for system audio (only while listening)
  useEffect(() => {
    if (state.mode !== 'listening') { return }
    if (!(inputMode === 'system' || inputMode === 'mixed')) { return }
    setSystemWarning('')
    const timeout = window.setTimeout(() => {
      if (systemLevel < 0.01) {
        setSystemWarning('No system audio detected. Ensure audio is playing and screen recording permissions are granted (macOS: System Settings > Privacy & Security > Screen Recording).')
      }
    }, 4000)
    return () => window.clearTimeout(timeout)
  }, [state.mode, inputMode, systemLevel])

  return (
  <div id="voice-panel" data-hidden={hiddenForCapture ? '1' : '0'} className={`relative mt-4 rounded-xl border border-white/10 bg-black/55 backdrop-blur-md p-4 text-white w-full max-w-[720px] transition-opacity duration-100 ${hiddenForCapture ? 'opacity-0 pointer-events-none select-none' : 'opacity-100'}`}> 
      <div className="flex items-start justify-between flex-wrap gap-4 relative">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold tracking-wide flex items-center gap-2">
            Voice Q&A
            <button
              aria-label={micMenuOpen ? 'Close microphone/input settings menu' : 'Open microphone/input settings menu'}
              onClick={() => setMicMenuOpen(o => !o)}
              className={`p-1 rounded hover:bg-white/10 transition-colors ${micMenuOpen ? 'text-amber-400' : 'text-white/60'}`}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1v4" />
                <path d="M12 19v4" />
                <rect x="9" y="5" width="6" height="10" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
              </svg>
            </button>
          </h2>
          <p className="text-[11px] text-white/60">Ask follow-up questions about the problem or solutions. Shortcut: <span className="px-1 py-0.5 bg-white/10 rounded">Ctrl/Cmd+M</span></p>
          {indicator && (
            <div className="text-amber-300 text-[12px] flex items-center gap-2">
              <span className={state.mode === 'listening' ? 'animate-pulse' : ''}>{indicator}</span>
              {state.mode === 'listening' && <span className="text-amber-400/80 text-[11px]">{formatTime(elapsed)}</span>}
            </div>
          )}
          {state.mode === 'listening' && (
            <div className="mt-2 flex flex-wrap gap-4 items-center">
              {(inputMode === 'mic' || inputMode === 'mixed') && (
                <div className="flex items-center gap-2">
                  <div className="w-28 h-2 bg-white/10 rounded overflow-hidden relative">
                    <div
                      className="absolute inset-0 bg-emerald-400 transition-transform duration-75 origin-left will-change-transform"
                      data-level={micLevel.toFixed(3)}
                      style={{ transform: `scaleX(${Math.min(1, Math.max(0, micLevel))})` }}
                    />
                  </div>
                  <span className="text-[10px] text-white/60 w-16">Mic{DEBUG_METERS && ` ${(debugMic*100).toFixed(0)}%`}</span>
                </div>
              )}
              {(inputMode === 'system' || inputMode === 'mixed') && (
                <div className="flex items-center gap-2">
                  <div className="w-28 h-2 bg-white/10 rounded overflow-hidden relative">
                    <div
                      className="absolute inset-0 bg-sky-400 transition-transform duration-75 origin-left will-change-transform"
                      data-level={systemLevel.toFixed(3)}
                      style={{ transform: `scaleX(${Math.min(1, Math.max(0, systemLevel))})` }}
                    />
                  </div>
                  <span className="text-[10px] text-white/60 w-16">System{DEBUG_METERS && ` ${(debugSys*100).toFixed(0)}%`}</span>
                </div>
              )}
              {DEBUG_METERS && debugInfo && (
                <div className="text-[9px] text-white/40 font-mono max-w-full break-all">
                  {debugInfo}{systemCaptureMethod && ` | method=${systemCaptureMethod}`} {systemDebug && ` | ${systemDebug}`}
                </div>
              )}
            </div>
          )}
          {state.error && (
            <div className="text-red-400/90 text-[12px]">
              Error: {state.error} <button className="ml-2 underline" onClick={() => setState({ mode: 'idle', error: undefined })}>clear</button>
            </div>
          )}
          {!state.error && systemWarning && (
            <div className="text-amber-400/90 text-[11px]">
              {systemWarning}
            </div>
          )}
        </div>
        <div className="flex gap-2 items-start">
          {state.mode === 'idle' && (
            <button onClick={startRecording} className="px-4 py-2 rounded-md bg-emerald-600/80 hover:bg-emerald-500 text-xs font-medium">Start Talking</button>
          )}
          {state.mode === 'listening' && (
            <button onClick={stopRecording} className="px-4 py-2 rounded-md bg-amber-600/80 hover:bg-amber-500 text-xs font-medium animate-pulse">Finish</button>
          )}
          {state.mode === 'processing' && (
            <button onClick={abortProcessing} className="px-4 py-2 rounded-md bg-sky-700/70 hover:bg-sky-600/70 text-xs font-medium flex items-center gap-2" title="Abort processing and reset">
              <span className="w-2 h-2 rounded-full bg-sky-300 animate-ping" /> Processing (Click to Abort)
            </button>
          )}
        </div>
      </div>

      {/* Conversation */}
      <div className="mt-4 space-y-3 max-h-[65vh] overflow-auto pr-1 custom-scrollbar" ref={conversationRef}>
          {history.length === 0 && !state.question && (
            <div className="text-[12px] text-white/50">No conversation yet. Ask your first question.</div>
          )}
          {history.map(turn => (
            <div key={turn.ts} className="space-y-1">
              <div className="bg-zinc-800/60 rounded p-2 text-[12px]">
                <span className="text-amber-300 font-semibold mr-1">You:</span>
                <span className="text-zinc-200 whitespace-pre-wrap">{turn.q}</span>
              </div>
              <div className="bg-zinc-700/50 rounded p-2 text-[12px]">
                <span className="text-green-300 font-semibold mr-1">AI:</span>
                <span className="text-zinc-100 whitespace-pre-wrap">{turn.a}</span>
              </div>
            </div>
          ))}
          {state.mode === 'processing' && state.question && (
            <div className="space-y-1 opacity-90">
              <div className="bg-zinc-800/60 rounded p-2 text-[12px]">
                <span className="text-amber-300 font-semibold mr-1">You:</span>
                <span className="text-zinc-200 whitespace-pre-wrap">{state.question}</span>
              </div>
              <div className="bg-zinc-700/50 rounded p-2 text-[12px] animate-pulse">
                <span className="text-green-300 font-semibold mr-1">AI:</span>
                <span className="text-zinc-100 whitespace-pre-wrap">{state.answer || '…'}</span>
              </div>
            </div>
          )}
        </div>
      {micMenuOpen && (
        <div ref={micMenuRef} className="absolute z-[12020] top-14 right-4 w-80 max-h-[70vh] overflow-auto custom-scrollbar rounded-md border border-white/10 bg-zinc-950/95 backdrop-blur shadow-xl p-4 text-[11px] space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="uppercase tracking-wide text-white/60 text-[10px]">Input Mode</span>
              <button onClick={() => setMicMenuOpen(false)} className="text-white/40 hover:text-white/70 text-[10px]">Close</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['mic','system','mixed'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => { setInputMode(mode); dispatchInputSettings({ inputMode: mode }) }}
                  className={`px-2 py-1 rounded border ${inputMode===mode ? 'border-amber-400 bg-amber-500/20 text-amber-200' : 'border-white/10 text-white/60 hover:bg-white/5'}`}
                >{mode === 'mic' ? 'Microphone' : mode === 'system' ? 'System' : 'Mixed'}</button>
              ))}
            </div>
          </div>
          {inputMode !== 'system' && (
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-white/40">Microphone</label>
              <select
                value={selectedMicId}
                onChange={e => { setSelectedMicId(e.target.value); dispatchInputSettings({ micId: e.target.value }) }}
                className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-amber-400/60"
              >
                {availableMics.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wide text-white/40 flex justify-between">
              <span>Meter Sensitivity</span>
              <span className="text-white/50">{meterGain.toFixed(2)}x</span>
            </label>
            <input
              type="range"
              min={0.5}
              max={2.5}
              step={0.1}
              value={meterGain}
              onChange={e => { const v = parseFloat(e.target.value); setMeterGain(v); dispatchInputSettings({ meterGain: v }) }}
              className="w-full accent-amber-400"
            />
            <p className="text-[10px] text-white/40">Lower if bar pegs at 100% while speaking normally.</p>
          </div>
          {inputMode !== 'mic' && (
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wide text-white/40">System Source / Screen</label>
              <select
                value={selectedDesktopSourceId}
                onChange={e => { setSelectedDesktopSourceId(e.target.value); dispatchInputSettings({ desktopSourceId: e.target.value }) }}
                className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-amber-400/60"
              >
                {desktopSources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <p className="text-[10px] text-white/40 leading-snug">macOS may need loopback (e.g. BlackHole) or Screen Recording permission for system audio.</p>
              <div className="mt-2 flex flex-wrap gap-2 items-center text-[10px]">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await (window as any).electronAPI.getScreenPermissions?.()
                      if (res?.success) {
                        setPermDiagnostics(`platform=${res.platform} screen=${res.screenAccess||'n/a'} mic=${res.micAccess||'n/a'} cam=${res.cameraAccess||'n/a'} chrome=${res.chromeVersion}`)
                      } else {
                        setPermDiagnostics('permission query failed: ' + (res?.error||'unknown'))
                      }
                    } catch (e:any) {
                      setPermDiagnostics('permission query error: ' + (e?.message||e))
                    }
                  }}
                  className="px-2 py-1 bg-zinc-700/60 hover:bg-zinc-600/70 rounded border border-white/10"
                >Permissions Diagnostic</button>
                {permDiagnostics && <span className="text-white/50 break-all max-w-full">{permDiagnostics}</span>}
              </div>
              {systemCaptureMethod && (
                <div className="mt-1 text-[10px] text-white/40">Method: {systemCaptureMethod}{systemDebug && ` • ${systemDebug}`}</div>
              )}
            </div>
          )}
        </div>
      )}
      {state.mode === 'idle' && !hasConversation && !state.error && (
        <div className="mt-4 text-[11px] text-white/50">Open the microphone icon menu to configure input sources, then press the shortcut or Start Talking.</div>
      )}
    </div>
  )
}

export default VoicePanel
