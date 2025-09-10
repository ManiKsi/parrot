import React, { useState, useEffect, useRef } from "react"
import { createRoot } from "react-dom/client"

import { useToast } from "../../contexts/toast"
import { LanguageSelector } from "../shared/LanguageSelector"
import { COMMAND_KEY } from "../../utils/platform"

interface QueueCommandsProps {
  onTooltipVisibilityChange: (visible: boolean, height: number) => void
  screenshotCount?: number
  credits: number
  currentLanguage: string
  setLanguage: (language: string) => void
}

const QueueCommands: React.FC<QueueCommandsProps> = ({
  onTooltipVisibilityChange,
  screenshotCount = 0,
  credits,
  currentLanguage,
  setLanguage
}) => {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()
  // Voice Q&A state (passive indicator driven by global shortcut)
  const [voiceMode, setVoiceMode] = useState<'idle' | 'listening' | 'processing'>('idle')
  const [voicePhaseMsg, setVoicePhaseMsg] = useState<string>('')
  const [voiceLastQuestion, setVoiceLastQuestion] = useState<string>('')
  const [voiceLastAnswer, setVoiceLastAnswer] = useState<string>('')
  // Voice input/source quick menu state
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false)
  const voiceMenuRef = useRef<HTMLDivElement | null>(null)
  const [inputMode, setInputMode] = useState<'mic' | 'system' | 'mixed'>('mic')
  const [availableMics, setAvailableMics] = useState<MediaDeviceInfo[]>([])
  const [selectedMicId, setSelectedMicId] = useState<string>('')
  const [desktopSources, setDesktopSources] = useState<{ id: string; name: string }[]>([])
  const [selectedDesktopSourceId, setSelectedDesktopSourceId] = useState<string>('')
  const [meterGain, setMeterGain] = useState<number>(1.0)

  // Subscribe to voice events if available
  useEffect(() => {
    const api: any = (window as any).electronAPI?.voice
    if (!api) return

    const offToggle = api.onToggle(() => {
      setVoiceMode(m => m === 'idle' ? 'listening' : (m === 'listening' ? 'processing' : m))
      if (voiceMode === 'idle') {
        setVoicePhaseMsg('Listening…')
      }
    })
    const offStatus = api.onStatus((s: { phase: string; message: string }) => {
      setVoiceMode('processing')
      setVoicePhaseMsg(s.message || 'Processing…')
    })
    const offResult = api.onResult((r: { question: string; answer: string }) => {
      setVoiceMode('idle')
      setVoicePhaseMsg('')
      setVoiceLastQuestion(r.question)
      setVoiceLastAnswer(r.answer)
    })
    const offErr = api.onError((_err: string) => {
      setVoiceMode('idle')
      setVoicePhaseMsg('')
    })
    return () => { offToggle && offToggle(); offStatus && offStatus(); offResult && offResult(); offErr && offErr() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load persisted meter gain and enumerate devices/sources when menu opens
  useEffect(() => {
    if (!voiceMenuOpen) return
    // Meter gain
    try {
      const stored = localStorage.getItem('voice.meterGain')
      if (stored) {
        const v = parseFloat(stored)
        if (!Number.isNaN(v) && v >= 0.5 && v <= 2.5) setMeterGain(v)
      }
    } catch {}
    // Devices
    (async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices()
        const mics = devices.filter(d => d.kind === 'audioinput')
        setAvailableMics(mics)
        if (!selectedMicId && mics.length) setSelectedMicId(mics[0].deviceId)
      } catch {}
      try {
        const res = await (window as any).electronAPI.getDesktopAudioSources?.()
        if (res?.success && res.sources) {
          setDesktopSources(res.sources)
          if (!selectedDesktopSourceId && res.sources.length) setSelectedDesktopSourceId(res.sources[0].id)
        }
      } catch {}
    })()
  }, [voiceMenuOpen, selectedMicId, selectedDesktopSourceId])

  // Outside click to close voice menu
  useEffect(() => {
    if (!voiceMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (voiceMenuRef.current && !voiceMenuRef.current.contains(e.target as Node)) {
        setVoiceMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [voiceMenuOpen])

  const dispatchVoiceInputUpdate = (detail: any) => {
    try { window.dispatchEvent(new CustomEvent('voice-input-settings-updated', { detail })) } catch {}
  }

  const applyMeterGain = (value: number) => {
    setMeterGain(value)
    try { localStorage.setItem('voice.meterGain', String(value)) } catch {}
    dispatchVoiceInputUpdate({ meterGain: value })
  }

  // Extract the repeated language selection logic into a separate function
  const extractLanguagesAndUpdate = (direction?: 'next' | 'prev') => {
    // Create a hidden instance of LanguageSelector to extract languages
    const hiddenRenderContainer = document.createElement('div');
    hiddenRenderContainer.style.position = 'absolute';
    hiddenRenderContainer.style.left = '-9999px';
    document.body.appendChild(hiddenRenderContainer);
    
    // Create a root and render the LanguageSelector temporarily
    const root = createRoot(hiddenRenderContainer);
    root.render(
      <LanguageSelector 
        currentLanguage={currentLanguage} 
        setLanguage={() => {}}
      />
    );
    
    // Use a small delay to ensure the component has rendered
    // 50ms is generally enough for React to complete a render cycle
    setTimeout(() => {
      // Extract options from the rendered select element
      const selectElement = hiddenRenderContainer.querySelector('select');
      if (selectElement) {
        const options = Array.from(selectElement.options);
        const values = options.map(opt => opt.value);
        
        // Find current language index
        const currentIndex = values.indexOf(currentLanguage);
        let newIndex = currentIndex;
        
        if (direction === 'prev') {
          // Go to previous language
          newIndex = (currentIndex - 1 + values.length) % values.length;
        } else {
          // Default to next language
          newIndex = (currentIndex + 1) % values.length;
        }
        
        if (newIndex !== currentIndex) {
          setLanguage(values[newIndex]);
          window.electronAPI.updateConfig({ language: values[newIndex] });
        }
      }
      
      // Clean up
      root.unmount();
      document.body.removeChild(hiddenRenderContainer);
    }, 50);
  };

  useEffect(() => {
    let tooltipHeight = 0
    if (tooltipRef.current && isTooltipVisible) {
      tooltipHeight = tooltipRef.current.offsetHeight + 10
    }
    onTooltipVisibilityChange(isTooltipVisible, tooltipHeight)
  }, [isTooltipVisible])

  const handleSignOut = async () => {
    try {
      // Clear any local storage or electron-specific data
      localStorage.clear();
      sessionStorage.clear();
      
      // Clear the API key in the configuration
      await window.electronAPI.updateConfig({
        apiKey: '',
      });
      
      showToast('Success', 'Logged out successfully', 'success');
      
      // Reload the app after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (err) {
      console.error("Error logging out:", err);
      showToast('Error', 'Failed to log out', 'error');
    }
  }

  const handleMouseEnter = () => {
    setIsTooltipVisible(true)
  }

  const handleMouseLeave = () => {
    setIsTooltipVisible(false)
  }

  // Direct Solve Mode state (loaded from config once)
  const [directSolveMode, setDirectSolveMode] = useState<boolean>(false)
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const cfg = await window.electronAPI.getConfig()
        if (mounted) setDirectSolveMode(!!cfg.directSolveMode)
      } catch (e) { /* silent */ }
    })()
    // Listen to global shortcut updates
    const off = window.electronAPI.onDirectModeUpdated?.((d: { enabled: boolean }) => {
      setDirectSolveMode(!!d.enabled)
    })
    return () => { mounted = false }
  }, [])

  const toggleDirectMode = async () => {
    const newVal = !directSolveMode
    setDirectSolveMode(newVal)
    try { await window.electronAPI.updateConfig({ directSolveMode: newVal }) } catch {}
  }

  return (
    <div className="relative z-[12010]">{/* Elevated root to ensure tooltips/menu sit above voice overlay (z-[9999]) */}
      <div className="pt-2 w-fit">
        <div className="text-xs text-white/90 backdrop-blur-md bg-black/60 rounded-lg py-2 px-4 flex items-center justify-center gap-4">
          {/* Screenshot */}
          <div
            className="flex items-center gap-2 cursor-pointer rounded px-2 py-1.5 hover:bg-white/10 transition-colors"
            onClick={async () => {
              try {
                const result = await window.electronAPI.triggerScreenshot()
                if (!result.success) {
                  console.error("Failed to take screenshot:", result.error)
                  showToast("Error", "Failed to take screenshot", "error")
                }
              } catch (error) {
                console.error("Error taking screenshot:", error)
                showToast("Error", "Failed to take screenshot", "error")
              }
            }}
          >
            <span className="text-[11px] leading-none truncate">
              {screenshotCount === 0
                ? "Take first screenshot"
                : screenshotCount === 1
                ? "Take second screenshot"
                : screenshotCount === 2
                ? "Take third screenshot"
                : screenshotCount === 3
                ? "Take fourth screenshot"
                : screenshotCount === 4
                ? "Take fifth screenshot"
                : "Next will replace first screenshot"}
            </span>
            <div className="flex gap-1">
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                {COMMAND_KEY}
              </button>
              <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                H
              </button>
            </div>
          </div>

          {/* Solve Command */}
          {screenshotCount > 0 && (
            <div
              className={`flex flex-col cursor-pointer rounded px-2 py-1.5 hover:bg-white/10 transition-colors ${
                credits <= 0 ? "opacity-50 cursor-not-allowed" : ""
              }`}
              onClick={async () => {

                try {
                  const result =
                    await window.electronAPI.triggerProcessScreenshots()
                  if (!result.success) {
                    console.error(
                      "Failed to process screenshots:",
                      result.error
                    )
                    showToast("Error", "Failed to process screenshots", "error")
                  }
                } catch (error) {
                  console.error("Error processing screenshots:", error)
                  showToast("Error", "Failed to process screenshots", "error")
                }
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] leading-none">Solve </span>
                <div className="flex gap-1 ml-2">
                  <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                    {COMMAND_KEY}
                  </button>
                  <button className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
                    ↵
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Direct Mode Checkbox (compact) */}
          <div className="flex items-center gap-1 pl-2 pr-3 py-1.5 text-[10px] text-white/70 bg-white/5 rounded cursor-pointer hover:bg-white/10 select-none" onClick={toggleDirectMode} title="Direct Solve Mode: single-pass interpretation & solution (skip extraction phase)">
            <input type="checkbox" checked={directSolveMode} onChange={toggleDirectMode} className="accent-white scale-90" />
            <span>Direct</span>
          </div>

          {/* Voice Q&A Indicator with source menu */}
          <div className="relative">
            <div
              className="flex flex-col cursor-pointer rounded px-2 py-1.5 hover:bg-white/10 transition-colors min-w-[130px]"
              title="Press Ctrl/Cmd+M to start/stop Voice Q&A. Click to open input settings."
              onClick={() => setVoiceMenuOpen(o => !o)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] leading-none flex items-center gap-1">
                  <span className={`inline-block w-2 h-2 rounded-full ${voiceMode === 'listening' ? 'bg-amber-400 animate-pulse' : voiceMode === 'processing' ? 'bg-sky-400 animate-pulse' : 'bg-emerald-500'}`}></span>
                  Voice
                  <svg className={`w-3 h-3 transition-transform ${voiceMenuOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                </span>
                <div className="flex gap-1">
                  <span className="bg-white/10 rounded-md px-1.5 py-1 text-[10px] leading-none text-white/70">{COMMAND_KEY}</span>
                  <span className="bg-white/10 rounded-md px-1.5 py-1 text-[10px] leading-none text-white/70">M</span>
                </div>
              </div>
              <div className="mt-1 text-[10px] text-white/60 line-clamp-2 max-w-[180px]">
                {voiceMode === 'listening' && 'Listening… speak your question'}
                {voiceMode === 'processing' && (voicePhaseMsg || 'Processing…')}
                {voiceMode === 'idle' && (
                  voiceLastQuestion ? `Q: ${voiceLastQuestion.slice(0,40)}…` : 'Ready'
                )}
              </div>
            </div>
            {voiceMenuOpen && (
              <div ref={voiceMenuRef} className="absolute top-full left-0 mt-2 w-72 z-[12015]">
                <div className="p-3 text-xs bg-black/85 backdrop-blur-md rounded-lg border border-white/10 text-white/90 shadow-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Input Source</span>
                    <button onClick={() => setVoiceMenuOpen(false)} className="text-white/40 hover:text-white/70 text-[10px]">Close</button>
                  </div>
                  <div className="flex gap-2">
                    {(['mic','system','mixed'] as const).map(mode => (
                      <button
                        key={mode}
                        onClick={() => { setInputMode(mode); dispatchVoiceInputUpdate({ inputMode: mode }) }}
                        className={`flex-1 px-2 py-1 rounded border text-[11px] capitalize transition-colors ${inputMode === mode ? 'bg-white/15 border-white/30' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                      >{mode}</button>
                    ))}
                  </div>
                  {(inputMode === 'mic' || inputMode === 'mixed') && (
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wide text-white/50">Microphone</label>
                      <select
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-white/30"
                        value={selectedMicId}
                        onChange={e => { setSelectedMicId(e.target.value); dispatchVoiceInputUpdate({ micId: e.target.value }) }}
                      >
                        {availableMics.map(m => (
                          <option key={m.deviceId} value={m.deviceId}>{m.label || 'Microphone'}</option>
                        ))}
                      </select>
                      {availableMics.length === 0 && <div className="text-[10px] text-amber-400/90">No microphones detected</div>}
                    </div>
                  )}
                  {(inputMode === 'system' || inputMode === 'mixed') && (
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wide text-white/50">System Audio Source</label>
                      <select
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-white/30"
                        value={selectedDesktopSourceId}
                        onChange={e => { setSelectedDesktopSourceId(e.target.value); dispatchVoiceInputUpdate({ desktopSourceId: e.target.value }) }}
                      >
                        {desktopSources.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                      {desktopSources.length === 0 && <div className="text-[10px] text-amber-400/90">No system sources (grant screen recording?)</div>}
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-wide text-white/50 flex items-center justify-between">
                      Meter Gain
                      <span className="text-white/40">{meterGain.toFixed(2)}x</span>
                    </label>
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.05}
                      value={meterGain}
                      onChange={e => applyMeterGain(parseFloat(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-[10px] text-white/40 leading-snug">Adjust visualization sensitivity. Does not change submitted audio.</p>
                  </div>
                  <div className="flex justify-end">
                    <button
                      onClick={() => { setVoiceMenuOpen(false) }}
                      className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-[11px]"
                    >Done</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Separator */}
          <div className="mx-2 h-4 w-px bg-white/20" />

          {/* Settings with Tooltip */}
          <div
            className="relative inline-block"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {/* Gear icon */}
            <div className="w-4 h-4 flex items-center justify-center cursor-pointer text-white/70 hover:text-white/90 transition-colors">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3.5 h-3.5"
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l-.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>

            {/* Tooltip Content */}
            {isTooltipVisible && (
              <div
                ref={tooltipRef}
                className="absolute top-full left-0 mt-2 w-80 transform -translate-x-[calc(50%-12px)] z-[12010]"
                style={{
                  // Elevate above voice overlay (z-[9999]) and standard dialogs/toasts
                  // SettingsDialog uses 12000 so we pick 12010 to sit just above while not going extreme
                  zIndex: 12010
                }}
              >
                {/* Add transparent bridge */}
                <div className="absolute -top-2 right-0 w-full h-2" />
                <div className="p-3 text-xs bg-black/80 backdrop-blur-md rounded-lg border border-white/10 text-white/90 shadow-lg">
                  <div className="space-y-4">
                    <h3 className="font-medium truncate">Keyboard Shortcuts</h3>
                    <div className="space-y-3">
                      {/* Toggle Command */}
                      <div
                        className="cursor-pointer rounded px-2 py-1.5 hover:bg-white/10 transition-colors"
                        onClick={async () => {
                          try {
                            const result =
                              await window.electronAPI.toggleMainWindow()
                            if (!result.success) {
                              console.error(
                                "Failed to toggle window:",
                                result.error
                              )
                              showToast(
                                "Error",
                                "Failed to toggle window",
                                "error"
                              )
                            }
                          } catch (error) {
                            console.error("Error toggling window:", error)
                            showToast(
                              "Error",
                              "Failed to toggle window",
                              "error"
                            )
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">Toggle Window</span>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              {COMMAND_KEY}
                            </span>
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              B
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-white/70 truncate mt-1">
                          Show or hide this window.
                        </p>
                      </div>

                      {/* Screenshot Command */}
                      <div
                        className="cursor-pointer rounded px-2 py-1.5 hover:bg-white/10 transition-colors"
                        onClick={async () => {
                          try {
                            const result =
                              await window.electronAPI.triggerScreenshot()
                            if (!result.success) {
                              console.error(
                                "Failed to take screenshot:",
                                result.error
                              )
                              showToast(
                                "Error",
                                "Failed to take screenshot",
                                "error"
                              )
                            }
                          } catch (error) {
                            console.error("Error taking screenshot:", error)
                            showToast(
                              "Error",
                              "Failed to take screenshot",
                              "error"
                            )
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">Take Screenshot</span>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              {COMMAND_KEY}
                            </span>
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              H
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-white/70 truncate mt-1">
                          Take a screenshot of the problem description.
                        </p>
                      </div>

                      {/* Solve Command */}
                      <div
                        className={`cursor-pointer rounded px-2 py-1.5 hover:bg-white/10 transition-colors ${
                          screenshotCount > 0
                            ? ""
                            : "opacity-50 cursor-not-allowed"
                        }`}
                        onClick={async () => {
                          if (screenshotCount === 0) return

                          try {
                            const result =
                              await window.electronAPI.triggerProcessScreenshots()
                            if (!result.success) {
                              console.error(
                                "Failed to process screenshots:",
                                result.error
                              )
                              showToast(
                                "Error",
                                "Failed to process screenshots",
                                "error"
                              )
                            }
                          } catch (error) {
                            console.error(
                              "Error processing screenshots:",
                              error
                            )
                            showToast(
                              "Error",
                              "Failed to process screenshots",
                              "error"
                            )
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">Solve</span>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              {COMMAND_KEY}
                            </span>
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              ↵
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-white/70 truncate mt-1">
                          {screenshotCount > 0
                            ? "Generate a solution based on the current problem."
                            : "Take a screenshot first to generate a solution."}
                        </p>
                      </div>
                      
                      {/* Delete Last Screenshot Command */}
                      <div
                        className={`cursor-pointer rounded px-2 py-1.5 hover:bg-white/10 transition-colors ${
                          screenshotCount > 0
                            ? ""
                            : "opacity-50 cursor-not-allowed"
                        }`}
                        onClick={async () => {
                          if (screenshotCount === 0) return
                          
                          try {
                            const result = await window.electronAPI.deleteLastScreenshot()
                            if (!result.success) {
                              console.error(
                                "Failed to delete last screenshot:",
                                result.error
                              )
                              showToast(
                                "Error",
                                result.error || "Failed to delete screenshot",
                                "error"
                              )
                            }
                          } catch (error) {
                            console.error("Error deleting screenshot:", error)
                            showToast(
                              "Error",
                              "Failed to delete screenshot",
                              "error"
                            )
                          }
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate">Delete Last Screenshot</span>
                          <div className="flex gap-1 flex-shrink-0">
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              {COMMAND_KEY}
                            </span>
                            <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] leading-none">
                              L
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] leading-relaxed text-white/70 truncate mt-1">
                          {screenshotCount > 0
                            ? "Remove the most recently taken screenshot."
                            : "No screenshots to delete."}
                        </p>
                      </div>
                    </div>

                    {/* Separator and Log Out */}
                    <div className="pt-3 mt-3 border-t border-white/10">
                      {/* Simplified Language Selector */}
                      <div className="mb-3 px-2">
                        <div 
                          className="flex items-center justify-between cursor-pointer hover:bg-white/10 rounded px-2 py-1 transition-colors"
                          onClick={() => extractLanguagesAndUpdate('next')}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                              extractLanguagesAndUpdate('prev');
                            } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                              extractLanguagesAndUpdate('next');
                            }
                          }}
                        >
                          <span className="text-[11px] text-white/70">Language</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-white/90">{currentLanguage}</span>
                            <div className="text-white/40 text-[8px]">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                                <path d="M7 13l5 5 5-5M7 6l5 5 5-5"/>
                              </svg>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* API Key Settings */}
                      <div className="mb-3 px-2 space-y-1">
                        <div className="flex items-center justify-between text-[13px] font-medium text-white/90">
                          <span>OpenAI API Settings</span>
                          <button
                            className="bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-[11px]"
                            onClick={() => window.electronAPI.openSettingsPortal()}
                          >
                            Settings
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={handleSignOut}
                        className="flex items-center gap-2 text-[11px] text-red-400 hover:text-red-300 transition-colors w-full"
                      >
                        <div className="w-4 h-4 flex items-center justify-center">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-3 h-3"
                          >
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                          </svg>
                        </div>
                        Log Out
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default QueueCommands
