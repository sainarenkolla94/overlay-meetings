import React, { useEffect, useMemo, useRef, useState } from "react";
import { Brain, CheckCircle2, Clipboard, Eye, EyeOff, KeyRound, Mic, Pause, Play, Settings, Sparkles, X } from "lucide-react";
import { createRoot } from "react-dom/client";
import type { AnalyzeResult, AppSettings, AssistantStatus, TeamsStatus } from "../shared/types";
import "./styles.css";

const defaultSettings: AppSettings = {
  provider: "openai",
  openAiApiKey: "",
  openRouterApiKey: "",
  model: "gpt-4.1-mini",
  openRouterModel: "meta-llama/llama-3.2-3b-instruct:free",
  transcriptionModel: "gpt-4o-mini-transcribe",
  preferredLanguage: "Python",
  triggerHotkey: "CommandOrControl+Shift+Space",
  hideHotkey: "CommandOrControl+Shift+H",
  captureMode: "screen"
};

type Mode = "coding" | "behavioral" | "meeting";

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
  const recognitionRef = useRef<SpeechRecognition | null>(null);

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

    const removeAnalyze = overlayApi.onAnalyzeShortcut(() => {
      void analyze();
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

  async function refreshTeamsStatus() {
    const current = await overlayApi.getTeamsStatus();
    setTeamsStatus(current);
  }

  async function saveSettings() {
    const saved = await overlayApi.saveSettings(draftSettings);
    setSettings(saved);
    setShowSettings(false);
  }

  async function analyze() {
    setStatus("analyzing");
    setError("");
    try {
      const result: AnalyzeResult = await overlayApi.analyzeNow({ transcript, mode });
      setAnswer(result.answer);
      setLastCapture(result.screenshotDataUrl);
      setStatus("ready");
      await refreshTeamsStatus();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Analyze failed.");
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

  async function copyAnswer() {
    await navigator.clipboard.writeText(answer);
  }

  return (
    <main className="shell">
      <header className="titlebar">
        <div className="brand">
          <div className="logo">
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
          <button title="Settings" onClick={() => setShowSettings(true)} className="iconButton">
            <Settings size={16} />
          </button>
          <button title="Hide overlay" onClick={() => overlayApi.hideOverlay()} className="iconButton">
            <X size={16} />
          </button>
        </div>
      </header>

      <section className="statusStrip">
        <span className={teamsStatus?.detected ? "dot ok" : "dot"} />
        <span>{teamsStatus?.message ?? "Checking Microsoft Teams..."}</span>
      </section>

      <section className="modeBar" aria-label="Assistant mode">
        <button className={mode === "coding" ? "selected" : ""} onClick={() => setMode("coding")}>Coding</button>
        <button className={mode === "behavioral" ? "selected" : ""} onClick={() => setMode("behavioral")}>Behavioral</button>
        <button className={mode === "meeting" ? "selected" : ""} onClick={() => setMode("meeting")}>Meeting</button>
      </section>

      <section className="controls">
        <button className="primary" onClick={analyze} disabled={status === "analyzing"}>
          <Sparkles size={17} />
          Analyze
        </button>
        <button onClick={toggleMic}>
          {status === "listening" ? <Pause size={17} /> : <Mic size={17} />}
          {status === "listening" ? "Pause mic" : "Mic"}
        </button>
        <button onClick={() => setTranscript("")}>Clear</button>
      </section>

      <section className="answerPanel">
        <div className="panelHeader">
          <span>Suggestion</span>
          <button title="Copy answer" onClick={copyAnswer} className="iconButton small">
            <Clipboard size={15} />
          </button>
        </div>
        {status === "analyzing" ? <div className="loader">Reading screen and transcript...</div> : <pre>{answer}</pre>}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="transcriptPanel">
        <div className="panelHeader">
          <span>Recent transcript</span>
          <span className="hint">Manual text works too</span>
        </div>
        <textarea
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          placeholder="Paste or dictate recent Teams conversation here for now."
        />
      </section>

      <footer className="footer">
        <span><KeyRound size={14} /> {settings.triggerHotkey}</span>
        <span><CheckCircle2 size={14} /> {settings.provider} · {maskedKey}</span>
      </footer>

      {lastCapture && (
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
