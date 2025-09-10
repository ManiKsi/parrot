import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Settings } from "lucide-react";
import { useToast } from "../../contexts/toast";

type APIProvider = "openai" | "gemini" | "anthropic";

type AIModel = {
  id: string;
  name: string;
  description: string;
};

type ModelCategory = {
  key: 'extractionModel' | 'solutionModel' | 'debuggingModel';
  title: string;
  description: string;
  openaiModels: AIModel[];
  geminiModels: AIModel[];
  anthropicModels: AIModel[];
};

// Define available models for each category
const modelCategories: ModelCategory[] = [
  {
    key: 'extractionModel',
    title: 'Problem Extraction',
    description: 'Model used to analyze screenshots and extract problem details',
    openaiModels: [
      {
        id: "gpt-4o",
        name: "gpt-4o",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "gpt-4o-mini",
        name: "gpt-4o-mini",
        description: "Faster, more cost-effective option"
      }
    ],
    geminiModels: [
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Best overall performance for problem extraction"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ]
  },
  {
    key: 'solutionModel',
    title: 'Solution Generation',
    description: 'Model used to generate coding solutions',
    openaiModels: [
      {
        id: "gpt-4o",
        name: "gpt-4o",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "gpt-4o-mini",
        name: "gpt-4o-mini",
        description: "Faster, more cost-effective option"
      }
    ],
    geminiModels: [
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Strong overall performance for coding tasks"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ]
  },
  {
    key: 'debuggingModel',
    title: 'Debugging',
    description: 'Model used to debug and improve solutions',
    openaiModels: [
      {
        id: "gpt-4o",
        name: "gpt-4o",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "gpt-4o-mini",
        name: "gpt-4o-mini",
        description: "Faster, more cost-effective option"
      }
    ],
    geminiModels: [
      {
        id: "gemini-1.5-pro",
        name: "Gemini 1.5 Pro",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Faster, more cost-effective option"
      }
    ],
    anthropicModels: [
      {
        id: "claude-3-7-sonnet-20250219",
        name: "Claude 3.7 Sonnet",
        description: "Best for analyzing code and error messages"
      },
      {
        id: "claude-3-5-sonnet-20241022",
        name: "Claude 3.5 Sonnet",
        description: "Balanced performance and speed"
      },
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
        description: "Top-level intelligence, fluency, and understanding"
      }
    ]
  }
];

interface SettingsDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SettingsDialog({ open: externalOpen, onOpenChange }: SettingsDialogProps) {
  const [open, setOpen] = useState(externalOpen || false);
  const [apiKey, setApiKey] = useState("");
  const [apiProvider, setApiProvider] = useState<APIProvider>("openai");
  const [extractionModel, setExtractionModel] = useState("gpt-4o");
  const [solutionModel, setSolutionModel] = useState("gpt-4o");
  const [debuggingModel, setDebuggingModel] = useState("gpt-4o");
  const [directSolveMode, setDirectSolveMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  // Voice settings state
  const [voiceModel, setVoiceModel] = useState("")
  const [voiceModelSaving, setVoiceModelSaving] = useState(false)
  const [voiceContext, setVoiceContext] = useState("")
  const [voiceContextDirty, setVoiceContextDirty] = useState(false)
  const [voiceHistoryEnabled, setVoiceHistoryEnabled] = useState(true)
  const [voiceHistoryCount, setVoiceHistoryCount] = useState(0)
  const voiceSaveTimeoutRef = useRef<number | null>(null)
  // Simple domain selector + managed prompt template
  const languageOptions = [
    'Java','JavaScript','TypeScript','Python','Go','Rust','C#','C++','Kotlin','Scala','Swift','SQL','AWS','Azure','GCP','DevOps','Docker','Kubernetes','React','Node.js','Spring','Hibernate'
  ]
  const [voiceDomain, setVoiceDomain] = useState('Java')

  const generateManagedPrompt = (domain: string) => {
    // Classification guides nuance without hardcoding specific domain directives
    const frameworkSet = new Set(['Spring','React','Node.js','Hibernate','Kubernetes','Docker'])
    const languageSet = new Set(['Java','JavaScript','TypeScript','Python','Go','Rust','C#','C++','Kotlin','Scala','Swift','SQL'])
    const platformSet = new Set(['AWS','Azure','GCP','DevOps'])
    let domainGuidance: string
    if (frameworkSet.has(domain)) {
      domainGuidance = `Framework Focus: give definition + lifecycle/IOC or runtime mechanics + minimal idiomatic code (annotations/config) + when to use.`
    } else if (languageSet.has(domain)) {
      domainGuidance = `Language Focus: give definition + core API/construct + minimal idiomatic snippet in ${domain}.`
    } else if (platformSet.has(domain)) {
      domainGuidance = `Platform Focus: describe service/component choice + architecture + concise CLI/config snippet when relevant.`
    } else {
      domainGuidance = `Domain Focus: ground explanation in ${domain} best practices and implementation specifics.`
    }

    return (
      `SYSTEM INSTRUCTIONS:\n` +
      `Primary Domain: ${domain}\n` +
      `Answer Style: interview, concise, authoritative, neutral, no filler.\n` +
      `Scope: All questions are software engineering technical.\n` +
      `${domainGuidance}\n` +
      `Concept Handling:\n` +
      `- Single-word or short noun phrase (≤3 words): treat as "Explain and show minimal ${domain} implementation".\n` +
      `- Provide one direct Answer if unambiguous; use Options only for materially distinct meanings.\n` +
      `- Always prefer minimal current, idiomatic style (annotations/config for frameworks; latest stable syntax for languages).\n` +
      `Disambiguation: If ambiguous, output 2–3 labeled Options (Option 1:/Option 2:/Option 3:).\n` +
      `Malformed Input: Repair silently and proceed.\n` +
      `Conflicts: If user wording conflicts with reality, respond with corrected concept directly.\n` +
      `Length: 1–3 sentences (or per option).\n` +
      `Code: One concise code block (<12 lines) if implementation applies; no superfluous comments.\n` +
      `Format:\nAnswer: <direct answer OR Option 1:/Option 2:/Option 3:>\nOptional Addendum: [Note: <single caveat>] only if materially useful (edge/pitfall/performance).\n` +
      `Forbidden: apologies, preambles, rhetorical questions, marketing tone, unrelated tangents, clarification requests unless blocking.`
    )
  }

  const isManagedTemplate = (txt: string) => /SYSTEM INSTRUCTIONS:/i.test(txt) && /Answer Style: interview/i.test(txt)

  // Initialize / parse existing domain from stored context
  useEffect(() => {
    if (!open) return
    if (!voiceContext) {
      const p = generateManagedPrompt(voiceDomain)
      setVoiceContext(p)
      setVoiceContextDirty(true)
      return
    }
    const m = voiceContext.match(/Primary Domain:\s*(.+)/i)
    if (m && m[1]) {
      const found = m[1].trim()
      if (languageOptions.includes(found)) setVoiceDomain(found)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // When domain changes, update prompt if still managed (user hasn't heavily customized it)
  useEffect(() => {
    if (!open) return
    if (!voiceContext || isManagedTemplate(voiceContext)) {
      const p = generateManagedPrompt(voiceDomain)
      setVoiceContext(p)
      setVoiceContextDirty(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceDomain])

  // Sync with external open state
  useEffect(() => {
    if (externalOpen !== undefined) {
      setOpen(externalOpen);
    }
  }, [externalOpen]);

  // Handle open state changes
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    // Only call onOpenChange when there's actually a change
    if (onOpenChange && newOpen !== externalOpen) {
      onOpenChange(newOpen);
    }
  };
  
  // Load current config on dialog open
  useEffect(() => {
    if (open) {
      setIsLoading(true);
      interface Config {
        apiKey?: string;
        apiProvider?: APIProvider;
        extractionModel?: string;
        solutionModel?: string;
        debuggingModel?: string;
        directSolveMode?: boolean;
      }

      window.electronAPI
        .getConfig()
        .then((config: Config) => {
          setApiKey(config.apiKey || "");
          setApiProvider(config.apiProvider || "openai");
          setExtractionModel(config.extractionModel || "gpt-4o");
          setSolutionModel(config.solutionModel || "gpt-4o");
          setDebuggingModel(config.debuggingModel || "gpt-4o");
          setDirectSolveMode(!!config.directSolveMode);
        })
        .catch((error: unknown) => {
          console.error("Failed to load config:", error);
          showToast("Error", "Failed to load settings", "error");
        })
        .finally(() => {
          setIsLoading(false);
        });

      // Load voice settings (best-effort; ignore failures quietly)
      (async () => {
        try {
          const voiceApi = (window as any).electronAPI?.voice
          if (!voiceApi) return
          try {
            const ctxRes = await voiceApi.getContext(); if (ctxRes?.context) setVoiceContext(ctxRes.context)
          } catch {}
          try {
            const modelRes = await voiceApi.getModel(); if (modelRes?.model) setVoiceModel(modelRes.model)
          } catch {}
            try {
              const he = await voiceApi.getHistoryEnabled(); if (typeof he?.enabled === 'boolean') setVoiceHistoryEnabled(he.enabled)
            } catch {}
          try {
            const hist = await voiceApi.getHistory(); if (hist?.history) setVoiceHistoryCount(hist.history.length)
          } catch {}
        } catch (e) {
          // Non-fatal; keep silent to avoid noisy UX
          console.warn('[SettingsDialog] Voice settings load failed', e)
        }
      })()
    }
  }, [open, showToast]);

  // Handle API provider change
  const handleProviderChange = (provider: APIProvider) => {
    setApiProvider(provider);
    
    // Reset models to defaults when changing provider
    if (provider === "openai") {
      setExtractionModel("gpt-4o");
      setSolutionModel("gpt-4o");
      setDebuggingModel("gpt-4o");
    } else if (provider === "gemini") {
      setExtractionModel("gemini-1.5-pro");
      setSolutionModel("gemini-1.5-pro");
      setDebuggingModel("gemini-1.5-pro");
    } else if (provider === "anthropic") {
      setExtractionModel("claude-3-7-sonnet-20250219");
      setSolutionModel("claude-3-7-sonnet-20250219");
      setDebuggingModel("claude-3-7-sonnet-20250219");
    }
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const result = await window.electronAPI.updateConfig({
        apiKey,
        apiProvider,
        extractionModel,
        solutionModel,
        debuggingModel,
        directSolveMode,
      });
      
      if (result) {
        showToast("Success", "Settings saved successfully", "success");
        handleOpenChange(false);
        
        // Force reload the app to apply the API key
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
      showToast("Error", "Failed to save settings", "error");
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced auto-save for voice context
  useEffect(() => {
    if (!open) return
    if (!voiceContextDirty) return
    if (voiceSaveTimeoutRef.current) window.clearTimeout(voiceSaveTimeoutRef.current)
    voiceSaveTimeoutRef.current = window.setTimeout(async () => {
      try {
        await (window as any).electronAPI?.voice?.setContext(voiceContext)
        setVoiceContextDirty(false)
        try { window.dispatchEvent(new CustomEvent('voice-settings-updated', { detail: { context: voiceContext } })) } catch {}
      } catch (e) {
        console.warn('[SettingsDialog] Failed to save voice context', e)
      }
    }, 700)
  }, [voiceContext, voiceContextDirty, open])

  // Helpers for voice settings actions
  const applyVoiceModel = async () => {
    if (!voiceModel) return
    setVoiceModelSaving(true)
    try {
      await (window as any).electronAPI?.voice?.setModel(voiceModel)
      try { window.dispatchEvent(new CustomEvent('voice-settings-updated', { detail: { model: voiceModel } })) } catch {}
    } finally { setVoiceModelSaving(false) }
  }

  const toggleVoiceHistory = async (enabled: boolean) => {
    setVoiceHistoryEnabled(enabled)
    try { await (window as any).electronAPI?.voice?.setHistoryEnabled(enabled) } finally {
      try { window.dispatchEvent(new CustomEvent('voice-settings-updated', { detail: { historyEnabled: enabled } })) } catch {}
    }
  }

  const clearVoiceHistory = async () => {
    try { await (window as any).electronAPI?.voice?.clearHistory(); setVoiceHistoryCount(0) } finally {
      try { window.dispatchEvent(new CustomEvent('voice-settings-updated', { detail: { historyCleared: true } })) } catch {}
    }
  }

  // Mask API key for display
  const maskApiKey = (key: string) => {
    if (!key || key.length < 10) return "";
    return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
  };

  // Open external link handler
  const openExternalLink = (url: string) => {
    window.electronAPI.openLink(url);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="sm:max-w-md bg-black border border-white/10 text-white settings-dialog"
        style={{
          position: 'fixed',
            // Center positioning
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
            // Sizing
          width: 'min(450px, 90vw)',
          height: 'auto',
          minHeight: '400px',
          maxHeight: '90vh',
          overflowY: 'auto',
            // Ensure this stays above voice overlay (z-[9999]) and any toasts (z-[100])
          zIndex: 12000,
          margin: 0,
          padding: '20px',
          transition: 'opacity 0.25s ease, transform 0.25s ease',
          animation: 'fadeIn 0.25s ease forwards',
          opacity: 0.98
        }}
      >        
        <DialogHeader>
          <DialogTitle>API Settings</DialogTitle>
          <DialogDescription className="text-white/70">
            Configure your API key and model preferences. You'll need your own API key to use this application.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Mode Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-white"
                checked={directSolveMode}
                onChange={(e) => setDirectSolveMode(e.target.checked)}
              />
              Direct Solve Mode (single-pass)
            </label>
            <p className="text-xs text-white/60 leading-relaxed">
              When enabled, the app will skip the two-step extraction -&gt; solution flow and directly interpret and solve
              whatever is in the screenshots (problem description, partial code, buggy code, or high-level task) in one pass.
            </p>
          </div>
          {/* API Provider Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-white">API Provider</label>
            <div className="flex gap-2">
              <div
                className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                  apiProvider === "openai"
                    ? "bg-white/10 border border-white/20"
                    : "bg-black/30 border border-white/5 hover:bg-white/5"
                }`}
                onClick={() => handleProviderChange("openai")}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      apiProvider === "openai" ? "bg-white" : "bg-white/20"
                    }`}
                  />
                  <div className="flex flex-col">
                    <p className="font-medium text-white text-sm">OpenAI</p>
                    <p className="text-xs text-white/60">GPT-4o models</p>
                  </div>
                </div>
              </div>
              <div
                className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                  apiProvider === "gemini"
                    ? "bg-white/10 border border-white/20"
                    : "bg-black/30 border border-white/5 hover:bg-white/5"
                }`}
                onClick={() => handleProviderChange("gemini")}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      apiProvider === "gemini" ? "bg-white" : "bg-white/20"
                    }`}
                  />
                  <div className="flex flex-col">
                    <p className="font-medium text-white text-sm">Gemini</p>
                    <p className="text-xs text-white/60">Gemini 1.5 models</p>
                  </div>
                </div>
              </div>
              <div
                className={`flex-1 p-2 rounded-lg cursor-pointer transition-colors ${
                  apiProvider === "anthropic"
                    ? "bg-white/10 border border-white/20"
                    : "bg-black/30 border border-white/5 hover:bg-white/5"
                }`}
                onClick={() => handleProviderChange("anthropic")}
              >
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      apiProvider === "anthropic" ? "bg-white" : "bg-white/20"
                    }`}
                  />
                  <div className="flex flex-col">
                    <p className="font-medium text-white text-sm">Claude</p>
                    <p className="text-xs text-white/60">Claude 3 models</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-white" htmlFor="apiKey">
            {apiProvider === "openai" ? "OpenAI API Key" : 
             apiProvider === "gemini" ? "Gemini API Key" : 
             "Anthropic API Key"}
            </label>
            <Input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                apiProvider === "openai" ? "sk-..." : 
                apiProvider === "gemini" ? "Enter your Gemini API key" :
                "sk-ant-..."
              }
              className="bg-black/50 border-white/10 text-white"
            />
            {apiKey && (
              <p className="text-xs text-white/50">
                Current: {maskApiKey(apiKey)}
              </p>
            )}
            <p className="text-xs text-white/50">
              Your API key is stored locally and never sent to any server except {apiProvider === "openai" ? "OpenAI" : "Google"}
            </p>
            <div className="mt-2 p-2 rounded-md bg-white/5 border border-white/10">
              <p className="text-xs text-white/80 mb-1">Don't have an API key?</p>
              {apiProvider === "openai" ? (
                <>
                  <p className="text-xs text-white/60 mb-1">1. Create an account at <button 
                    onClick={() => openExternalLink('https://platform.openai.com/signup')} 
                    className="text-blue-400 hover:underline cursor-pointer">OpenAI</button>
                  </p>
                  <p className="text-xs text-white/60 mb-1">2. Go to <button 
                    onClick={() => openExternalLink('https://platform.openai.com/api-keys')} 
                    className="text-blue-400 hover:underline cursor-pointer">API Keys</button> section
                  </p>
                  <p className="text-xs text-white/60">3. Create a new secret key and paste it here</p>
                </>
              ) : apiProvider === "gemini" ?  (
                <>
                  <p className="text-xs text-white/60 mb-1">1. Create an account at <button 
                    onClick={() => openExternalLink('https://aistudio.google.com/')} 
                    className="text-blue-400 hover:underline cursor-pointer">Google AI Studio</button>
                  </p>
                  <p className="text-xs text-white/60 mb-1">2. Go to the <button 
                    onClick={() => openExternalLink('https://aistudio.google.com/app/apikey')} 
                    className="text-blue-400 hover:underline cursor-pointer">API Keys</button> section
                  </p>
                  <p className="text-xs text-white/60">3. Create a new API key and paste it here</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-white/60 mb-1">1. Create an account at <button 
                    onClick={() => openExternalLink('https://console.anthropic.com/signup')} 
                    className="text-blue-400 hover:underline cursor-pointer">Anthropic</button>
                  </p>
                  <p className="text-xs text-white/60 mb-1">2. Go to the <button 
                    onClick={() => openExternalLink('https://console.anthropic.com/settings/keys')} 
                    className="text-blue-400 hover:underline cursor-pointer">API Keys</button> section
                  </p>
                  <p className="text-xs text-white/60">3. Create a new API key and paste it here</p>
                </>
              )}
            </div>
          </div>
          
          <div className="space-y-2 mt-4">
            <label className="text-sm font-medium text-white mb-2 block">Keyboard Shortcuts</label>
            <div className="bg-black/30 border border-white/10 rounded-lg p-3">
              <div className="grid grid-cols-2 gap-y-2 text-xs">
                <div className="text-white/70">Toggle Visibility</div>
                <div className="text-white/90 font-mono">Ctrl+B / Cmd+B</div>
                
                <div className="text-white/70">Take Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+H / Cmd+H</div>
                
                <div className="text-white/70">Process Screenshots</div>
                <div className="text-white/90 font-mono">Ctrl+Enter / Cmd+Enter</div>
                
                <div className="text-white/70">Delete Last Screenshot</div>
                <div className="text-white/90 font-mono">Ctrl+L / Cmd+L</div>
                
                <div className="text-white/70">Reset View</div>
                <div className="text-white/90 font-mono">Ctrl+R / Cmd+R</div>
                
                <div className="text-white/70">Quit Application</div>
                <div className="text-white/90 font-mono">Ctrl+Q / Cmd+Q</div>
                
                <div className="text-white/70">Move Window</div>
                <div className="text-white/90 font-mono">Ctrl+Arrow Keys</div>
                
                <div className="text-white/70">Decrease Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+[ / Cmd+[</div>
                
                <div className="text-white/70">Increase Opacity</div>
                <div className="text-white/90 font-mono">Ctrl+] / Cmd+]</div>
                
                <div className="text-white/70">Zoom Out</div>
                <div className="text-white/90 font-mono">Ctrl+- / Cmd+-</div>
                
                <div className="text-white/70">Reset Zoom</div>
                <div className="text-white/90 font-mono">Ctrl+0 / Cmd+0</div>
                
                <div className="text-white/70">Zoom In</div>
                <div className="text-white/90 font-mono">Ctrl+= / Cmd+=</div>
              </div>
            </div>
          </div>
          
          <div className="space-y-4 mt-4">
            <label className="text-sm font-medium text-white">AI Model Selection</label>
            <p className="text-xs text-white/60 -mt-3 mb-2">
              Select which models to use for each stage of the process
            </p>
            
            {modelCategories.map((category) => {
              // Get the appropriate model list based on selected provider
              const models = 
                apiProvider === "openai" ? category.openaiModels : 
                apiProvider === "gemini" ? category.geminiModels :
                category.anthropicModels;
              
              return (
                <div key={category.key} className="mb-4">
                  <label className="text-sm font-medium text-white mb-1 block">
                    {category.title}
                  </label>
                  <p className="text-xs text-white/60 mb-2">{category.description}</p>
                  
                  <div className="space-y-2">
                    {models.map((m) => {
                      // Determine which state to use based on category key
                      const currentValue = 
                        category.key === 'extractionModel' ? extractionModel :
                        category.key === 'solutionModel' ? solutionModel :
                        debuggingModel;
                      
                      // Determine which setter function to use
                      const setValue = 
                        category.key === 'extractionModel' ? setExtractionModel :
                        category.key === 'solutionModel' ? setSolutionModel :
                        setDebuggingModel;
                        
                      return (
                        <div
                          key={m.id}
                          className={`p-2 rounded-lg cursor-pointer transition-colors ${
                            currentValue === m.id
                              ? "bg-white/10 border border-white/20"
                              : "bg-black/30 border border-white/5 hover:bg-white/5"
                          }`}
                          onClick={() => setValue(m.id)}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className={`w-3 h-3 rounded-full ${
                                currentValue === m.id ? "bg-white" : "bg-white/20"
                              }`}
                            />
                            <div>
                              <p className="font-medium text-white text-xs">{m.name}</p>
                              <p className="text-xs text-white/60">{m.description}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Voice Q&A Settings */}
          <div className="space-y-3 mt-8">
            <label className="text-sm font-medium text-white flex items-center gap-2">
              Voice Q&A Settings
              <span className="text-[10px] px-1 py-0.5 rounded bg-white/10 text-white/60">Experimental</span>
            </label>
            <p className="text-xs text-white/60 -mt-2">Configure default voice assistant behavior. These settings affect voice recording sessions (shortcut: Ctrl/Cmd+M).</p>

            {/* Voice Model */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-white/80">Preferred Voice Model (override)</label>
              <div className="flex gap-2">
                <Input
                  value={voiceModel}
                  onChange={(e) => setVoiceModel(e.target.value)}
                  placeholder="e.g. phi3:latest or gpt-4o-mini"
                  className="bg-black/50 border-white/10 text-white text-xs"
                />
                <Button
                  disabled={!voiceModel || voiceModelSaving}
                  onClick={applyVoiceModel}
                  className="text-xs px-3"
                >{voiceModelSaving ? 'Saving...' : 'Apply'}</Button>
              </div>
              <p className="text-[10px] text-white/50 leading-snug">If set, this model will be tried first for voice answers before internal fallbacks (phi3, mistral, llama3, gemma).</p>
            </div>

            {/* Voice Context */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-white/80">Voice Assistant Context</label>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <label className="text-[10px] uppercase tracking-wide text-white/50">Primary Domain / Technology</label>
                <select
                  value={voiceDomain}
                  onChange={e=>setVoiceDomain(e.target.value)}
                  className="bg-black/50 border border-white/10 rounded px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-white/30"
                >
                  {languageOptions.map(l=> <option key={l} value={l}>{l}</option>)}
                </select>
                <span className="text-[10px] text-white/40">Changing domain updates prompt if not customized.</span>
                <button
                  type="button"
                  onClick={() => { const p = generateManagedPrompt(voiceDomain); setVoiceContext(p); setVoiceContextDirty(true) }}
                  className="ml-auto px-2 py-1 rounded bg-amber-500/80 hover:bg-amber-400 text-black text-[10px] font-medium"
                >Regenerate</button>
              </div>
              <textarea
                value={voiceContext}
                onChange={(e) => { setVoiceContext(e.target.value); setVoiceContextDirty(true) }}
                placeholder="e.g. You are a senior engineer focusing on clear, concise explanations."
                className="w-full h-20 bg-black/50 border border-white/10 rounded-md p-2 text-xs focus:outline-none focus:ring-1 focus:ring-white/30 resize-y"
              />
              <div className="flex items-center justify-between">
                {voiceContextDirty ? (
                  <span className="text-[10px] text-amber-300">Saving…</span>
                ) : (
                  <span className="text-[10px] text-white/40">Auto-saved locally</span>
                )}
                {voiceContext && (
                  <button
                    onClick={() => { setVoiceContext(''); setVoiceContextDirty(true) }}
                    className="text-[10px] text-white/50 hover:text-white/70 underline"
                  >Clear</button>
                )}
              </div>
            </div>

            {/* History Controls */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-white/80">Conversation History</label>
              <div className="flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={voiceHistoryEnabled}
                    onChange={(e) => toggleVoiceHistory(e.target.checked)}
                  />
                  <span className="text-white/80">Enabled</span>
                </label>
                <Button
                  variant="outline"
                  disabled={!voiceHistoryCount}
                  onClick={clearVoiceHistory}
                  className="h-7 px-2 text-xs border-white/10 hover:bg-white/5"
                >Clear ({voiceHistoryCount})</Button>
              </div>
              <p className="text-[10px] text-white/40 leading-snug">History is stored only on your device and improves follow-up questions. Disable for a stateless assistant.</p>
            </div>
          </div>
        </div>
        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-white/10 hover:bg-white/5 text-white"
          >
            Cancel
          </Button>
          <Button
            className="px-4 py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-colors"
            onClick={handleSave}
            disabled={isLoading || !apiKey}
          >
            {isLoading ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
