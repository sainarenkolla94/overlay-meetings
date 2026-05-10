import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  CheckCircle2,
  Clipboard,
  CornerDownLeft,
  CornerDownRight,
  CornerUpLeft,
  CornerUpRight,
  Eye,
  EyeOff,
  GalleryVerticalEnd,
  KeyRound,
  Lock,
  Mic,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Sparkles,
  Timer,
  Unlock,
  X
} from "lucide-react";
import { createRoot } from "react-dom/client";
import type { AnalyzeResult, AppSettings, AssistantStatus, TeamsStatus, WindowSnapPosition } from "../shared/types";
import "./styles.css";

const defaultSettings: AppSettings = {
  provider: "openai",
  openAiApiKey: "",
  openRouterApiKey: "",
  model: "gpt-4.1-mini",
  openRouterModel: "google/gemma-4-26b-a4b-it:free",
  sendScreenshotToOpenRouter: true,
  transcriptionModel: "gpt-4o-mini-transcribe",
  preferredLanguage: "Python",
  triggerHotkey: "CommandOrControl+Shift+Space",
  hideHotkey: "CommandOrControl+Shift+H",
  autoAnalyzeIntervalSeconds: 20,
  captureMode: "screen"
};

type Mode = "coding" | "behavioral" | "meeting";
type ViewMode = "full" | "glass" | "stealth";
type SuggestionItem = {
  id: number;
  answer: string;
  mode: Mode;
  createdAt: string;
};

const overlayApi =
  window.overlayApi ??
  ({
    getSettings: async () => defaultSettings,
    saveSettings: async (settings: AppSettings) => settings,
    analyzeNow: async () => ({
      answer:
        "Electron preload is not connected in browser preview. Run npm run dev to use screen capture, Teams detection, and OpenAI analysis.",
      teamsDetected: false
    }),
    getTeamsStatus: async () => ({
      detected: false,
      platform: navigator.platform.toLowerCase().includes("win") ? "win32" : "darwin",
      message: "Browser preview mode. Teams detection runs in the Electron app."
    }),
    setClickThrough: async () => undefined,
    setResizable: async () => undefined,
    setCompact: async () => undefined,
    nudgeWindow: async () => undefined,
    snapWindow: async () => undefined,
    hideOverlay: async () => undefined,
    onAnalyzeShortcut: () => () => undefined,
    onToggleVisibility: () => () => undefined
  } satisfies Window["overlayApi"]);

function statusLabel(status: AssistantStatus) {
  if (status === "listening") return "Listening";
  if (status === "analyzing") return "Analyzing";
  if (status === "ready") return "Answer ready";
  if (status === "error") return "Needs attention";
  return "Idle";
}

function App() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [draftSettings, setDraftSettings] = useState<AppSettings>(defaultSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<Mode>("coding");
  const [status, setStatus] = useState<AssistantStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState("Press Analyze after joining a Teams meeting or when a coding problem is visible on screen.");
  const [teamsStatus, setTeamsStatus] = useState<TeamsStatus | null>(null);
  const [clickThrough, setClickThrough] = useState(false);
  const [lastCapture, setLastCapture] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [compact, setCompact] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("full");
  const [resizeLocked, setResizeLocked] = useState(true);
  const [history, setHistory] = useState<SuggestionItem[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef(transcript);
  const modeRef = useRef(mode);
  const autoAnalyzeRef = useRef(autoAnalyze);
  const analyzingRef = useRef(false);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    autoAnalyzeRef.current = autoAnalyze;
  }, [autoAnalyze]);

  const maskedKey = useMemo(() => {
    const key = settings.provider === "openrouter" ? settings.openRouterApiKey : settings.openAiApiKey;
    if (!key) return "No API key";
    return `${key.slice(0, 7)}...${key.slice(-4)}`;
  }, [settings.openAiApiKey, settings.openRouterApiKey, settings.provider]);

  useEffect(() => {
    overlayApi.getSettings().then((loaded) => {
      setSettings(loaded);
      setDraftSettings(loaded);
    });
    refreshTeamsStatus();
    void overlayApi.setResizable(false);

    const removeAnalyze = overlayApi.onAnalyzeShortcut(() => {
      void analyze(transcriptRef.current, modeRef.current);
    });
    const removeToggle = overlayApi.onToggleVisibility(() => setClickThrough(false));

    const interval = window.setInterval(refreshTeamsStatus, 5000);
    return () => {
      removeAnalyze();
      removeToggle();
      window.clearInterval(interval);
      recognitionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!autoAnalyze) return undefined;

    const intervalMs = Math.max(settings.autoAnalyzeIntervalSeconds, 8) * 1000;
    const interval = window.setInterval(() => {
      if (!autoAnalyzeRef.current || analyzingRef.current) return;
      if (!transcriptRef.current.trim() && !settings.sendScreenshotToOpenRouter && settings.provider === "openrouter") return;
      void analyze(transcriptRef.current, modeRef.current, "auto");
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [autoAnalyze, settings.autoAnalyzeIntervalSeconds, settings.provider, settings.sendScreenshotToOpenRouter]);

  async function refreshTeamsStatus() {
    const current = await overlayApi.getTeamsStatus();
    setTeamsStatus(current);
  }

  async function saveSettings() {
    const saved = await overlayApi.saveSettings(draftSettings);
    setSettings(saved);
    setShowSettings(false);
  }

  async function analyze(transcriptForRequest = transcript, modeForRequest = mode, source: "manual" | "auto" = "manual") {
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    setStatus("analyzing");
    setError("");
    try {
      const result: AnalyzeResult = await overlayApi.analyzeNow({
        transcript: transcriptForRequest,
        mode: modeForRequest
      });
      setAnswer(result.answer);
      setHistory((previous) => [
        {
          id: Date.now(),
          answer: result.answer,
          mode: modeForRequest,
          createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        },
        ...previous
      ].slice(0, 5));
      setLastCapture(result.screenshotDataUrl);
      setStatus("ready");
      await refreshTeamsStatus();
    } catch (err) {
      setStatus("error");
      setError(`${source === "auto" ? "Auto analyze failed" : "Analyze failed"}: ${err instanceof Error ? err.message : "Unknown error."}`);
    } finally {
      analyzingRef.current = false;
    }
  }

  function toggleMic() {
    if (status === "listening") {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setStatus("idle");
      return;
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setStatus("error");
      setError("This Chromium build does not expose Web Speech recognition. We will replace this with OpenAI transcription in the next pass.");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const text = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ");
      setTranscript((previous) => `${previous}\n${text}`.trim());
    };
    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      setStatus("error");
      setError(event.error);
    };
    recognition.onend = () => {
      if (recognitionRef.current === recognition) setStatus("idle");
    };
    recognitionRef.current = recognition;
    recognition.start();
    setStatus("listening");
  }

  async function toggleClickThrough() {
    const next = !clickThrough;
    setClickThrough(next);
    await overlayApi.setClickThrough(next);
  }

  async function toggleCompact() {
    const next = !compact;
    setCompact(next);
    setViewMode(next ? "glass" : "full");
    if (next) {
      setResizeLocked(true);
      await overlayApi.setCompact(true);
      return;
    }
    await overlayApi.setCompact(false);
    await overlayApi.setResizable(!resizeLocked);
  }

  async function toggleResizeLock() {
    const next = !resizeLocked;
    setResizeLocked(next);
    await overlayApi.setResizable(!next && !compact);
  }

  async function snap(position: WindowSnapPosition) {
    await overlayApi.snapWindow(position);
  }

  async function setModeView(next: ViewMode) {
    setViewMode(next);
    setCompact(next !== "full");
    setResizeLocked(true);
    await overlayApi.setCompact(next !== "full");
  }

  async function copyAnswer() {
    await navigator.clipboard.writeText(answer);
  }

  async function copyTranscript() {
    await navigator.clipboard.writeText(transcript);
  }

  return (
    <main className={`shell ${compact ? "compactShell" : ""} ${viewMode}Mode`}>
      <header className="titlebar">
        <div className="brand">
          <div className="logo dragHandle" title="Drag overlay">
            <Brain size={18} />
          </div>
          <div>
            <strong>Overlay Meetings</strong>
            <span>{statusLabel(status)}</span>
          </div>
        </div>
        <div className="windowActions">
          <button title="Toggle click-through" onClick={toggleClickThrough} className={clickThrough ? "active iconButton" : "iconButton"}>
            {clickThrough ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button title="Compact mode" onClick={toggleCompact} className={compact ? "active iconButton" : "iconButton"}>
            <Minimize2 size={16} />
          </button>
          <button title="View mode" onClick={() => setModeView(viewMode === "full" ? "glass" : viewMode === "glass" ? "stealth" : "full")} className="iconButton">
            <GalleryVerticalEnd size={16} />
          </button>
          <button title="Lock resizing" onClick={toggleResizeLock} className={resizeLocked ? "active iconButton" : "iconButton"}>
            {resizeLocked ? <Lock size={16} /> : <Unlock size={16} />}
          </button>
          <button title="Settings" onClick={() => setShowSettings(true)} className="iconButton">
            <Settings size={16} />
          </button>
          <button title="Hide overlay" onClick={() => overlayApi.hideOverlay()} className="iconButton">
            <X size={16} />
          </button>
        </div>
      </header>

      <section className="snapBar" aria-label="Snap overlay">
        <button title="Snap top left" onClick={() => snap("top-left")}><CornerUpLeft size={15} /></button>
        <button title="Snap top right" onClick={() => snap("top-right")}><CornerUpRight size={15} /></button>
        <button title="Snap bottom left" onClick={() => snap("bottom-left")}><CornerDownLeft size={15} /></button>
        <button title="Snap bottom right" onClick={() => snap("bottom-right")}><CornerDownRight size={15} /></button>
        <span>Move: Ctrl+Alt+Arrows</span>
      </section>

      {viewMode !== "stealth" && (
        <section className="viewSwitcher" aria-label="View mode">
          <button className={viewMode === "full" ? "selected" : ""} onClick={() => setModeView("full")}>Full</button>
          <button className={viewMode === "glass" ? "selected" : ""} onClick={() => setModeView("glass")}>Glass</button>
          <button onClick={() => setModeView("stealth")}>Stealth</button>
        </section>
      )}

      {viewMode === "stealth" ? (
        <section className="stealthPill">
          <span className={status === "ready" ? "dot ok" : "dot"} />
          <strong>{status === "analyzing" ? "Analyzing..." : answer.slice(0, 92)}</strong>
          <button title="Analyze" onClick={() => analyze()} disabled={status === "analyzing"}>
            <Sparkles size={14} />
          </button>
        </section>
      ) : null}

      {!compact && viewMode !== "stealth" && <section className="statusStrip">
        <span className={teamsStatus?.detected ? "dot ok" : "dot"} />
        <span>{teamsStatus?.message ?? "Checking Microsoft Teams..."}</span>
      </section>}

      {viewMode !== "stealth" && <section className="modeBar" aria-label="Assistant mode">
        <button className={mode === "coding" ? "selected" : ""} onClick={() => setMode("coding")}>Coding</button>
        <button className={mode === "behavioral" ? "selected" : ""} onClick={() => setMode("behavioral")}>Behavioral</button>
        <button className={mode === "meeting" ? "selected" : ""} onClick={() => setMode("meeting")}>Meeting</button>
      </section>}

      {viewMode !== "stealth" && <section className="controls">
        <button className="primary" onClick={() => analyze()} disabled={status === "analyzing"}>
          <Sparkles size={17} />
          Analyze
        </button>
        <button className={autoAnalyze ? "active" : ""} onClick={() => setAutoAnalyze((enabled) => !enabled)}>
          <Timer size={17} />
          Auto
        </button>
        <button onClick={toggleMic}>
          {status === "listening" ? <Pause size={17} /> : <Mic size={17} />}
          {status === "listening" ? "Pause mic" : "Mic"}
        </button>
      </section>}

      {viewMode !== "stealth" && <section className="answerPanel">
        <div className="panelHeader">
          <span>Suggestion</span>
          <button title="Copy answer" onClick={copyAnswer} className="iconButton small">
            <Clipboard size={15} />
          </button>
        </div>
        {status === "analyzing" ? <div className="loader">Reading screen and transcript...</div> : <pre>{answer}</pre>}
        {error && <p className="error">{error}</p>}
      </section>}

      {!compact && <section className="transcriptPanel">
        <div className="panelHeader">
          <span>Recent transcript</span>
          <div className="panelActions">
            <button title="Copy transcript" onClick={copyTranscript} className="iconButton small">
              <Clipboard size={15} />
            </button>
            <button title="Clear transcript" onClick={() => setTranscript("")} className="iconButton small">
              <RotateCcw size={15} />
            </button>
          </div>
        </div>
        <textarea
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          placeholder="Paste or dictate recent Teams conversation here for now."
        />
      </section>}

      {!compact && history.length > 0 && (
        <section className="historyPanel">
          <div className="panelHeader">
            <span>Session history</span>
            <button title="Clear history" onClick={() => setHistory([])} className="iconButton small">
              <RotateCcw size={15} />
            </button>
          </div>
          <div className="historyList">
            {history.map((item) => (
              <button key={item.id} className="historyItem" onClick={() => setAnswer(item.answer)}>
                <span>{item.createdAt} · {item.mode}</span>
                <strong>{item.answer.slice(0, 92)}{item.answer.length > 92 ? "..." : ""}</strong>
              </button>
            ))}
          </div>
        </section>
      )}

      {!compact && <footer className="footer">
        <span><KeyRound size={14} /> {settings.triggerHotkey}</span>
        <span><CheckCircle2 size={14} /> {settings.provider} · {maskedKey}</span>
      </footer>}

      {!compact && lastCapture && (
        <details className="capturePreview">
          <summary>Last screen capture</summary>
          <img src={lastCapture} alt="Last captured screen" />
        </details>
      )}

      {showSettings && (
        <div className="modalBackdrop">
          <section className="settingsModal">
            <div className="panelHeader">
              <span>Settings</span>
              <button className="iconButton small" onClick={() => setShowSettings(false)}>
                <X size={15} />
              </button>
            </div>
            <label>
              Provider
              <select
                value={draftSettings.provider}
                onChange={(event) =>
                  setDraftSettings({ ...draftSettings, provider: event.target.value as AppSettings["provider"] })
                }
              >
                <option value="openai">OpenAI</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </label>
            <label>
              OpenAI API key
              <input
                type="password"
                value={draftSettings.openAiApiKey}
                onChange={(event) => setDraftSettings({ ...draftSettings, openAiApiKey: event.target.value })}
                placeholder="sk-..."
              />
            </label>
            <label>
              OpenAI model
              <input
                value={draftSettings.model}
                onChange={(event) => setDraftSettings({ ...draftSettings, model: event.target.value })}
              />
            </label>
            <label>
              OpenRouter API key
              <input
                type="password"
                value={draftSettings.openRouterApiKey}
                onChange={(event) => setDraftSettings({ ...draftSettings, openRouterApiKey: event.target.value })}
                placeholder="sk-or-..."
              />
            </label>
            <label>
              OpenRouter model
              <input
                value={draftSettings.openRouterModel}
                onChange={(event) => setDraftSettings({ ...draftSettings, openRouterModel: event.target.value })}
              />
            </label>
            <label className="checkboxRow">
              <input
                type="checkbox"
                checked={draftSettings.sendScreenshotToOpenRouter}
                onChange={(event) =>
                  setDraftSettings({ ...draftSettings, sendScreenshotToOpenRouter: event.target.checked })
                }
              />
              Send screenshot to OpenRouter
            </label>
            <label>
              Preferred coding language
              <input
                value={draftSettings.preferredLanguage}
                onChange={(event) => setDraftSettings({ ...draftSettings, preferredLanguage: event.target.value })}
              />
            </label>
            <label>
              Analyze hotkey
              <input
                value={draftSettings.triggerHotkey}
                onChange={(event) => setDraftSettings({ ...draftSettings, triggerHotkey: event.target.value })}
              />
            </label>
            <label>
              Hide hotkey
              <input
                value={draftSettings.hideHotkey}
                onChange={(event) => setDraftSettings({ ...draftSettings, hideHotkey: event.target.value })}
              />
            </label>
            <label>
              Auto analyze interval seconds
              <input
                type="number"
                min="8"
                max="120"
                value={draftSettings.autoAnalyzeIntervalSeconds}
                onChange={(event) =>
                  setDraftSettings({
                    ...draftSettings,
                    autoAnalyzeIntervalSeconds: Number(event.target.value)
                  })
                }
              />
            </label>
            <div className="modalActions">
              <button onClick={() => setDraftSettings(defaultSettings)}>Defaults</button>
              <button className="primary" onClick={saveSettings}>
                <Play size={16} />
                Save
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
