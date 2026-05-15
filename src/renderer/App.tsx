import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  CheckCircle2,
  Clipboard,
  Download,
  CornerDownLeft,
  CornerDownRight,
  CornerUpLeft,
  CornerUpRight,
  Eye,
  EyeOff,
  GalleryVerticalEnd,
  Headphones,
  KeyRound,
  Lock,
  Mic,
  Minimize2,
  Pause,
  Play,
  Power,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Timer,
  Unlock,
  X
} from "lucide-react";
import { createRoot } from "react-dom/client";
import type {
  AnalyzeResult,
  AppSettings,
  CaptureSource,
  CaptureContextResult,
  AssistantStatus,
  DesktopAudioSource,
  TeamsStatus,
  WindowSnapPosition
} from "../shared/types";
import "./styles.css";

const defaultSettings: AppSettings = {
  provider: "openai",
  transcriptionProvider: "openai",
  openAiApiKey: "",
  openRouterApiKey: "",
  geminiApiKey: "",
  geminiApiKeys: "",
  groqApiKey: "",
  groqApiKeys: "",
  model: "gpt-4.1-mini",
  openRouterModel: "google/gemma-4-26b-a4b-it:free",
  geminiModel: "gemini-2.5-flash",
  sendScreenshotToOpenRouter: true,
  sendScreenshotToGemini: true,
  transcriptionModel: "gpt-4o-mini-transcribe",
  groqTranscriptionModel: "whisper-large-v3-turbo",
  preferredLanguage: "Python",
  triggerHotkey: "CommandOrControl+Shift+Space",
  hideHotkey: "CommandOrControl+Shift+H",
  autoAnalyzeIntervalSeconds: 20,
  captureSourceId: "",
  captureMode: "screen"
};

type Mode = "coding" | "behavioral" | "meeting";
type ViewMode = "full" | "glass" | "stealth" | "focus";
type ProviderPreset = "gemini-groq" | "openrouter-groq" | "openai-only";
const audioSegmentMs = 5000;
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
      teamsDetected: false,
      sentImageToProvider: false,
      imageProvider: "openai",
      ocrText: ""
    }),
    captureContext: async () => ({ ocrText: "" }),
    getCaptureSources: async () => [],
    getDesktopAudioSources: async () => [],
    transcribeAudio: async () => ({ text: "" }),
    exportSession: async () => ({ filePath: "" }),
    getTeamsStatus: async () => ({
      detected: false,
      platform: navigator.platform.toLowerCase().includes("win") ? "win32" : "darwin",
      message: "Browser preview mode. Teams detection runs in the Electron app."
    }),
    setClickThrough: async () => undefined,
    setResizable: async () => undefined,
    setCompact: async () => undefined,
    setLauncher: async () => undefined,
    nudgeWindow: async () => undefined,
    snapWindow: async () => undefined,
    hideOverlay: async () => undefined,
    onAnalyzeShortcut: () => () => undefined,
    onToggleVisibility: () => () => undefined,
    onGlobalAction: () => () => undefined
  } satisfies Window["overlayApi"]);

function statusLabel(status: AssistantStatus) {
  if (status === "listening") return "Listening";
  if (status === "analyzing") return "Analyzing";
  if (status === "capturing") return "Capturing context";
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
  const [screenContext, setScreenContext] = useState("");
  const [answer, setAnswer] = useState("Press Analyze after joining a Teams meeting or when a coding problem is visible on screen.");
  const [teamsStatus, setTeamsStatus] = useState<TeamsStatus | null>(null);
  const [captureSources, setCaptureSources] = useState<CaptureSource[]>([]);
  const [clickThrough, setClickThrough] = useState(false);
  const [lastCapture, setLastCapture] = useState<string | undefined>();
  const [lastImageStatus, setLastImageStatus] = useState("No image sent yet");
  const [lastOcrStatus, setLastOcrStatus] = useState("OCR not run yet");
  const [lastDetectionStatus, setLastDetectionStatus] = useState("Detect idle");
  const [screenContextStatus, setScreenContextStatus] = useState("No saved screen context");
  const [sessionStatus, setSessionStatus] = useState("");
  const [error, setError] = useState("");
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [questionDetect, setQuestionDetect] = useState(false);
  const [systemAudioListening, setSystemAudioListening] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<Date | null>(null);
  const [sessionElapsedSeconds, setSessionElapsedSeconds] = useState(0);
  const [compact, setCompact] = useState(false);
  const [launcherMode, setLauncherMode] = useState(false);
  const [expandedAnswer, setExpandedAnswer] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("full");
  const [resizeLocked, setResizeLocked] = useState(true);
  const [history, setHistory] = useState<SuggestionItem[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const systemAudioRecorderRef = useRef<MediaRecorder | null>(null);
  const systemAudioStreamRef = useRef<MediaStream | null>(null);
  const systemAudioSegmentTimerRef = useRef<number | null>(null);
  const systemAudioListeningRef = useRef(false);
  const transcriptRef = useRef(transcript);
  const screenContextRef = useRef(screenContext);
  const modeRef = useRef(mode);
  const clickThroughRef = useRef(clickThrough);
  const compactRef = useRef(compact);
  const resizeLockedRef = useRef(resizeLocked);
  const launcherModeRef = useRef(launcherMode);
  const autoAnalyzeRef = useRef(autoAnalyze);
  const questionDetectRef = useRef(questionDetect);
  const lastQuestionAnalyzeAtRef = useRef(0);
  const lastAnalyzedTranscriptRef = useRef("");
  const analyzingRef = useRef(false);
  const contextBatchAnalyzedRef = useRef(false);
  const contextCaptureCountRef = useRef(0);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    screenContextRef.current = screenContext;
  }, [screenContext]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    clickThroughRef.current = clickThrough;
  }, [clickThrough]);

  useEffect(() => {
    compactRef.current = compact;
  }, [compact]);

  useEffect(() => {
    resizeLockedRef.current = resizeLocked;
  }, [resizeLocked]);

  useEffect(() => {
    launcherModeRef.current = launcherMode;
  }, [launcherMode]);

  useEffect(() => {
    autoAnalyzeRef.current = autoAnalyze;
  }, [autoAnalyze]);

  useEffect(() => {
    questionDetectRef.current = questionDetect;
  }, [questionDetect]);

  const maskedKey = useMemo(() => {
    const splitKeys = (value: string) => value.split(/[\s,;]+/).map((key) => key.trim()).filter(Boolean);
    const keyPoolLabel = (singleKey: string, keyPool: string) => {
      const keys = Array.from(new Set([singleKey, ...splitKeys(keyPool)].filter(Boolean)));
      if (keys.length > 1) return `${keys.length} keys`;
      const key = keys[0];
      return key ? `${key.slice(0, 7)}...${key.slice(-4)}` : "No API key";
    };

    const key =
      settings.provider === "openrouter"
        ? settings.openRouterApiKey
        : settings.provider === "gemini"
          ? settings.geminiApiKey
          : settings.openAiApiKey;
    if (settings.provider === "gemini") return keyPoolLabel(settings.geminiApiKey, settings.geminiApiKeys);
    if (!key) return "No API key";
    return `${key.slice(0, 7)}...${key.slice(-4)}`;
  }, [settings.geminiApiKey, settings.geminiApiKeys, settings.openAiApiKey, settings.openRouterApiKey, settings.provider]);

  useEffect(() => {
    overlayApi.getSettings().then((loaded) => {
      setSettings(loaded);
      setDraftSettings(loaded);
    });
    refreshTeamsStatus();
    refreshCaptureSources();
    void overlayApi.setResizable(false);

    const removeAnalyze = overlayApi.onAnalyzeShortcut(() => {
      void analyze(transcriptRef.current, modeRef.current, "manual", screenContextRef.current);
    });
    const removeToggle = overlayApi.onToggleVisibility(() => setClickThrough(false));
    const removeGlobalAction = overlayApi.onGlobalAction((action) => {
      if (action === "add-context") void addScreenContext();
      if (action === "clear-context") clearScreenContext();
      if (action === "toggle-detect") setQuestionDetect((enabled) => !enabled);
      if (action === "toggle-audio") void toggleSystemAudio();
      if (action === "copy-answer") void copyAnswer();
      if (action === "toggle-click-through") void toggleClickThrough();
      if (action === "cycle-view") void cycleViewMode();
      if (action === "toggle-bubble") void toggleLauncherMode();
    });

    const removeStream = overlayApi.onAnalyzeStream((chunk) => {
      setStatus("ready");
      setAnswer((prev) => prev + chunk);
    });

    const interval = window.setInterval(refreshTeamsStatus, 5000);
    return () => {
      removeAnalyze();
      removeToggle();
      removeGlobalAction();
      removeStream();
      window.clearInterval(interval);
      recognitionRef.current?.stop();
      stopSystemAudio();
    };
  }, []);

  useEffect(() => {
    if (!sessionStartedAt) {
      setSessionElapsedSeconds(0);
      return undefined;
    }

    const interval = window.setInterval(() => {
      setSessionElapsedSeconds(Math.floor((Date.now() - sessionStartedAt.getTime()) / 1000));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [sessionStartedAt]);

  useEffect(() => {
    if (!autoAnalyze) return undefined;

    const intervalMs = Math.max(settings.autoAnalyzeIntervalSeconds, 8) * 1000;
    const interval = window.setInterval(() => {
      if (!autoAnalyzeRef.current || analyzingRef.current) return;
      if (!transcriptRef.current.trim() && !settings.sendScreenshotToOpenRouter && settings.provider === "openrouter") return;
      void analyze(transcriptRef.current, modeRef.current, "auto", screenContextRef.current);
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [autoAnalyze, settings.autoAnalyzeIntervalSeconds, settings.provider, settings.sendScreenshotToOpenRouter]);

  useEffect(() => {
    if (!questionDetect) return undefined;

    const timeout = window.setTimeout(() => {
      const currentTranscript = transcriptRef.current.trim();
      if (!currentTranscript || analyzingRef.current) return;

      const lastAnalyzed = lastAnalyzedTranscriptRef.current;
      const newText = currentTranscript.slice(lastAnalyzed.length).trim();
      
      // Must have enough new words since last analysis to contain a question
      if (newText.length < 20) return;
      
      // Use a 4-second cooldown to avoid duplicate triggers
      const cooldownMs = 4000;

      if (Date.now() - lastQuestionAnalyzeAtRef.current < cooldownMs) return;
      
      // Auto-switch mode based on recent transcript window
      const recentWindow = currentTranscript.slice(-900);
      const nextMode = detectModeSwitch(recentWindow, modeRef.current);
      if (nextMode !== modeRef.current) {
        setMode(nextMode);
        modeRef.current = nextMode;
      }

      // Only check NEW text for question phrases to avoid re-triggering on old questions
      if (!isLikelyQuestion(newText, modeRef.current)) return;

      setLastDetectionStatus(explainDetection(newText, modeRef.current));
      lastQuestionAnalyzeAtRef.current = Date.now();
      lastAnalyzedTranscriptRef.current = currentTranscript;
      void analyze(currentTranscript, modeRef.current, "auto", "", {
        useScreenshot: false,
        responseStyle: "spoken"
      });
    }, 1500);

    return () => window.clearTimeout(timeout);
  }, [transcript, questionDetect, settings.autoAnalyzeIntervalSeconds]);

  function detectModeSwitch(text: string, currentMode: Mode): Mode {
    const normalized = text.toLowerCase();
    const behavioralPhrases = ["time you", "conflict", "manager", "disagree", "proud of", "weakness", "strength", "leadership"];
    const codingPhrases = ["array", "tree", "hash map", "string", "complexity", "optimize", "leetcode", "function", "code"];
    
    const recent = normalized.slice(-300);
    
    if (behavioralPhrases.some(p => recent.includes(p))) return "behavioral";
    if (codingPhrases.some(p => recent.includes(p))) return "coding";
    
    return currentMode;
  }

  function isLikelyQuestion(text: string, currentMode: Mode) {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
    if (normalized.length < 12) return false;

    const questionPhrases = [
      "?",
      "can you",
      "could you",
      "would you",
      "how would",
      "how do",
      "how about",
      "what is",
      "what's",
      "what are",
      "why",
      "explain",
      "walk me through",
      "tell me",
      "describe",
      "design",
      "debug",
      "fix",
      "implement",
      "write",
      "solve",
      "approach",
      "complexity",
      "edge case",
      "test case",
      "do you know",
      "have you used",
      "are you familiar",
      "let's talk about",
      "can we"
    ];

    if (questionPhrases.some((phrase) => normalized.includes(phrase))) return true;

    if (currentMode === "coding") {
      return [
        "given an array",
        "given a string",
        "return the",
        "find the",
        "leetcode",
        "time complexity",
        "space complexity",
        "binary tree",
        "linked list",
        "hash map",
        "dynamic programming",
        "optimize",
        "brute force"
      ].some((phrase) => normalized.includes(phrase));
    }

    return false;
  }

  function explainDetection(text: string, currentMode: Mode) {
    const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
    const phrases = [
      "can you",
      "could you",
      "would you",
      "how would",
      "what is",
      "explain",
      "walk me through",
      "implement",
      "solve",
      "complexity",
      "edge case"
    ];
    const matchedPhrase = phrases.find((phrase) => normalized.includes(phrase));
    if (matchedPhrase) return `Detected: ${matchedPhrase}`;
    if (currentMode === "coding") return "Detected: coding prompt";
    return "Detected: likely question";
  }

  async function refreshTeamsStatus() {
    const current = await overlayApi.getTeamsStatus();
    setTeamsStatus(current);
  }

  async function refreshCaptureSources() {
    const sources = await overlayApi.getCaptureSources();
    setCaptureSources(sources);
  }

  async function saveSettings() {
    const saved = await overlayApi.saveSettings(draftSettings);
    setSettings(saved);
    setShowSettings(false);
  }

  function applyProviderPreset(preset: ProviderPreset) {
    if (preset === "gemini-groq") {
      setDraftSettings({
        ...draftSettings,
        provider: "gemini",
        transcriptionProvider: "groq",
        geminiModel: "gemini-2.5-flash",
        groqTranscriptionModel: "whisper-large-v3-turbo",
        sendScreenshotToGemini: true
      });
    }

    if (preset === "openrouter-groq") {
      setDraftSettings({
        ...draftSettings,
        provider: "openrouter",
        transcriptionProvider: "groq",
        openRouterModel: "google/gemma-4-26b-a4b-it:free",
        groqTranscriptionModel: "whisper-large-v3-turbo",
        sendScreenshotToOpenRouter: true
      });
    }

    if (preset === "openai-only") {
      setDraftSettings({
        ...draftSettings,
        provider: "openai",
        transcriptionProvider: "openai",
        model: "gpt-4.1-mini",
        transcriptionModel: "gpt-4o-mini-transcribe"
      });
    }
  }

  function formatElapsed(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const seconds = (totalSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function toggleSession() {
    if (sessionStartedAt) {
      setSessionStartedAt(null);
      setAutoAnalyze(false);
      setQuestionDetect(false);
      stopSystemAudio();
      recognitionRef.current?.stop();
      return;
    }
    setSessionStartedAt(new Date());
    setQuestionDetect(true);
    setModeView("stealth");
    void refreshCaptureSources();
    void startSystemAudio();
  }

  function clearSession() {
    setTranscript("");
    clearScreenContext();
    setAnswer("Session cleared. Press Analyze after joining a Teams meeting or when a coding problem is visible on screen.");
    setHistory([]);
    setLastCapture(undefined);
    setLastImageStatus("No image sent yet");
    setLastOcrStatus("OCR not run yet");
    setLastDetectionStatus("Detect idle");
    setError("");
    setSessionStatus("");
  }

  async function exportSession() {
    try {
      const result = await overlayApi.exportSession({
        transcript,
        screenContext,
        answer,
        history: history.map((item) => ({
          answer: item.answer,
          mode: item.mode,
          createdAt: item.createdAt
        })),
        metadata: {
          provider: settings.provider,
          transcriptionProvider: settings.transcriptionProvider,
          startedAt: sessionStartedAt?.toISOString(),
          exportedAt: new Date().toISOString()
        }
      });
      setSessionStatus(`Exported: ${result.filePath}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export session.");
    }
  }

  function appendScreenContextCapture(existing: string, next: string) {
    const captureNumber = contextCaptureCountRef.current + 1;
    const cleanedText = next
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 1)
      .join("\n")
      .trim();

    if (!cleanedText) return existing.trim();

    contextCaptureCountRef.current = captureNumber;
    const captureBlock = `--- Capture ${captureNumber} ---\n${cleanedText}`;
    const merged = existing.trim() ? `${existing.trim()}\n\n${captureBlock}` : captureBlock;

    if (merged.length <= 30000) return merged;
    return `${merged.slice(0, 15000)}\n\n--- middle content trimmed to fit request ---\n\n${merged.slice(-15000)}`;
  }

  async function addScreenContext() {
    setStatus("capturing");
    setError("");
    try {
      const shouldStartFreshBatch = contextBatchAnalyzedRef.current;
      if (shouldStartFreshBatch) {
        contextBatchAnalyzedRef.current = false;
        contextCaptureCountRef.current = 0;
        setScreenContext("");
        screenContextRef.current = "";
        setTranscript("");
        transcriptRef.current = "";
        lastAnalyzedTranscriptRef.current = "";
        setAnswer("Capturing a new question...");
      }
      const result: CaptureContextResult = await overlayApi.captureContext();
      setLastCapture(result.screenshotDataUrl);
      setLastOcrStatus(result.ocrText ? `OCR extracted ${result.ocrText.length} chars` : "OCR extracted no text");
      setScreenContext((previous) => {
        const merged = appendScreenContextCapture(shouldStartFreshBatch ? "" : previous, result.ocrText);
        screenContextRef.current = merged;
        setScreenContextStatus(
          merged ? `Saved ${contextCaptureCountRef.current} capture${contextCaptureCountRef.current === 1 ? "" : "s"}: ${merged.length} chars` : "No text saved from capture"
        );
        return merged;
      });
      setStatus("ready");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not add screen context.");
    }
  }

  function clearScreenContext() {
    setScreenContext("");
    screenContextRef.current = "";
    setScreenContextStatus("No saved screen context");
    contextBatchAnalyzedRef.current = false;
    contextCaptureCountRef.current = 0;
  }

  async function analyze(
    transcriptForRequest = transcript,
    modeForRequest = mode,
    source: "manual" | "auto" | "continue" = "manual",
    screenContextForRequest = screenContext,
    options: { useScreenshot?: boolean; responseStyle?: "overlay" | "spoken" } = {}
  ) {
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    const shouldIgnoreOldContext = source !== "continue" && contextBatchAnalyzedRef.current;
    const requestScreenContext = shouldIgnoreOldContext ? "" : screenContextForRequest;
    if (shouldIgnoreOldContext) {
      setScreenContext("");
      screenContextRef.current = "";
      setScreenContextStatus("No saved screen context");
      contextBatchAnalyzedRef.current = false;
      contextCaptureCountRef.current = 0;
    }
    setStatus("analyzing");
    setAnswer("");
    setError("");
    try {
      // Prevent context overload by truncating long transcripts
      let safeTranscript = transcriptForRequest;
      if (safeTranscript.length > 3000) {
        safeTranscript = "(...earlier transcript truncated...)\n" + safeTranscript.slice(-3000);
      }

      const result: AnalyzeResult = await overlayApi.analyzeNow({
        transcript: safeTranscript,
        screenContext: requestScreenContext,
        mode: modeForRequest,
        useScreenshot: options.useScreenshot,
        responseStyle: options.responseStyle
      });
      setAnswer(result.answer);
      setLastImageStatus(result.sentImageToProvider ? `Image sent to ${result.imageProvider}` : `No image sent to ${result.imageProvider}`);
      setLastOcrStatus(result.ocrText ? `OCR extracted ${result.ocrText.length} chars` : "OCR extracted no text");
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
      lastAnalyzedTranscriptRef.current = transcriptForRequest.trim();
      contextBatchAnalyzedRef.current = true;
      setStatus("ready");
      await refreshTeamsStatus();
    } catch (err) {
      setStatus("error");
      setError(`${source === "auto" ? "Auto analyze failed" : "Analyze failed"}: ${err instanceof Error ? err.message : "Unknown error."}`);
    } finally {
      analyzingRef.current = false;
    }
  }

  async function continueAnswer() {
    const continuationPrompt = `${transcriptRef.current}

Previous answer appears incomplete. Continue and finish the answer from where it stopped. Do not restart unless necessary.

Previous answer:
${answer}`;
    await analyze(continuationPrompt, modeRef.current, "continue", screenContextRef.current);
  }

  async function flushSystemAudio() {
    if (systemAudioRecorderRef.current && systemAudioRecorderRef.current.state === "recording") {
      try {
        // Calling stop() forces the onstop handler to transcribe the current chunk
        // and immediately restart a new recorder because systemAudioListeningRef is still true.
        systemAudioRecorderRef.current.stop();
        // Wait briefly for the Groq transcription to finish processing
        await new Promise((resolve) => setTimeout(resolve, 800));
      } catch (e) {
        // Ignore if recorder is already stopped
      }
    }
  }

  async function analyzeTranscriptOnly() {
    await flushSystemAudio();
    await analyze(transcriptRef.current, modeRef.current, "manual", "", {
      useScreenshot: false,
      responseStyle: "spoken"
    });
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

  async function blobToBase64(blob: Blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return window.btoa(binary);
  }

  function appendTranscript(source: "system" | "mic", text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const label = source === "system" ? "Interviewer/System" : "Mic";
    setTranscript((previous) => `${previous}\n[${label}] ${trimmed}`.trim());
  }

  async function transcribeAudioChunk(blob: Blob, source: "system" | "mic") {
    if (!blob.size) return;
    try {
      const result = await overlayApi.transcribeAudio({
        base64Audio: await blobToBase64(blob),
        mimeType: blob.type || "audio/webm",
        source
      });
      appendTranscript(source, result.text);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Audio transcription failed.");
      if (source === "system") stopSystemAudio();
    }
  }

  function getSupportedAudioRecorderOptions(): Array<MediaRecorderOptions | undefined> {
    const candidates: MediaRecorderOptions[] = [
      { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32000 },
      { mimeType: "audio/webm", audioBitsPerSecond: 32000 },
      { mimeType: "video/webm;codecs=opus", audioBitsPerSecond: 32000 },
      { mimeType: "video/webm", audioBitsPerSecond: 32000 }
    ];

    return [
      ...candidates.filter((candidate) => !candidate.mimeType || MediaRecorder.isTypeSupported(candidate.mimeType)),
      undefined
    ];
  }

  function createStartedRecorder(stream: MediaStream, source: "system" | "mic") {
    let lastError: unknown;

    for (const options of getSupportedAudioRecorderOptions()) {
      try {
        const recorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        recorder.onstop = () => {
          if (source === "system" && systemAudioSegmentTimerRef.current) {
            window.clearTimeout(systemAudioSegmentTimerRef.current);
            systemAudioSegmentTimerRef.current = null;
          }

          if (chunks.length) {
            const mimeType = recorder.mimeType || chunks[0]?.type || "audio/webm";
            void transcribeAudioChunk(new Blob(chunks, { type: mimeType }), source);
          }

          if (source === "system" && systemAudioListeningRef.current && systemAudioStreamRef.current) {
            try {
              const nextRecorder = createStartedRecorder(systemAudioStreamRef.current, "system");
              systemAudioRecorderRef.current = nextRecorder;
            } catch (err) {
              setStatus("error");
              setError(err instanceof Error ? err.message : "Could not restart system audio recorder.");
              stopSystemAudio();
            }
          }
        };
        recorder.onerror = () => {
          setStatus("error");
          setError("System audio recorder failed.");
          stopSystemAudio();
        };
        recorder.start();
        if (source === "system") {
          systemAudioSegmentTimerRef.current = window.setTimeout(() => {
            if (recorder.state !== "inactive") recorder.stop();
          }, audioSegmentMs);
        }
        return recorder;
      } catch (err) {
        lastError = err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Could not start audio recorder with any supported format.");
  }

  async function startSystemAudio() {
    setError("");
    try {
      const sources: DesktopAudioSource[] = await overlayApi.getDesktopAudioSources();
      const source = sources[0];
      if (!source) {
        throw new Error("No desktop audio source found.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: source.id
          }
        },
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: source.id,
            maxWidth: 1,
            maxHeight: 1
          }
        }
      } as MediaStreamConstraints);

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Desktop capture started, but Windows did not provide an audio track. Make sure Teams audio is playing through system speakers/headphones, then try Audio again.");
      }

      const audioOnlyStream = new MediaStream(audioTracks);
      stream.getVideoTracks().forEach((track) => track.stop());
      const recorder = createStartedRecorder(audioOnlyStream, "system");

      systemAudioStreamRef.current = audioOnlyStream;
      systemAudioRecorderRef.current = recorder;
      systemAudioListeningRef.current = true;
      setSystemAudioListening(true);
      setStatus("listening");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not start system audio capture.");
      stopSystemAudio();
    }
  }

  function stopSystemAudio() {
    systemAudioListeningRef.current = false;
    if (systemAudioSegmentTimerRef.current) {
      window.clearTimeout(systemAudioSegmentTimerRef.current);
      systemAudioSegmentTimerRef.current = null;
    }
    systemAudioRecorderRef.current?.state !== "inactive" && systemAudioRecorderRef.current?.stop();
    systemAudioRecorderRef.current = null;
    systemAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
    systemAudioStreamRef.current = null;
    setSystemAudioListening(false);
    setStatus((current) => (current === "listening" ? "idle" : current));
  }

  async function toggleSystemAudio() {
    if (systemAudioListening) {
      stopSystemAudio();
      return;
    }
    await startSystemAudio();
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

  async function toggleLauncherMode() {
    const next = !launcherModeRef.current;
    if (next) {
      if (clickThroughRef.current) {
        setClickThrough(false);
        clickThroughRef.current = false;
        await overlayApi.setClickThrough(false);
      }
      await overlayApi.setLauncher(true);
      launcherModeRef.current = true;
      setLauncherMode(true);
      return;
    }
    launcherModeRef.current = false;
    setLauncherMode(false);
    await overlayApi.setLauncher(false);
    await overlayApi.setResizable(!resizeLockedRef.current && !compactRef.current);
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

  async function cycleViewMode() {
    const nextMode = viewMode === "full" ? "glass" : viewMode === "glass" ? "stealth" : viewMode === "stealth" ? "focus" : "full";
    await setModeView(nextMode);
  }

  async function copyAnswer() {
    await navigator.clipboard.writeText(answer);
  }

  async function copyTranscript() {
    await navigator.clipboard.writeText(transcript);
  }

  const answerOnlyView = viewMode === "stealth" || viewMode === "focus";

  return (
    <main className={`shell ${compact ? "compactShell" : ""} ${launcherMode ? "launcherShell" : ""} ${viewMode}Mode`}>
      {launcherMode ? (
        <button className="launcherButton" aria-label="Expand overlay" onClick={toggleLauncherMode}>
          <Brain size={24} />
        </button>
      ) : null}

      {!launcherMode && (
        <>
      <header className="titlebar">
        <div className="brand">
          <button className="logo logoButton" title="Collapse to bubble" onClick={toggleLauncherMode}>
            <Brain size={18} />
          </button>
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
          <button title="View mode" onClick={cycleViewMode} className="iconButton">
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

      {!answerOnlyView && <section className="snapBar" aria-label="Snap overlay">
        <button title="Snap top left" onClick={() => snap("top-left")}><CornerUpLeft size={15} /></button>
        <button title="Snap top right" onClick={() => snap("top-right")}><CornerUpRight size={15} /></button>
        <button title="Snap bottom left" onClick={() => snap("bottom-left")}><CornerDownLeft size={15} /></button>
        <button title="Snap bottom right" onClick={() => snap("bottom-right")}><CornerDownRight size={15} /></button>
        <span>Move: Ctrl+Alt+Arrows</span>
      </section>}

      {!answerOnlyView && <section className="imageStatus">
        {lastImageStatus} · {lastOcrStatus} · {screenContextStatus} · {lastDetectionStatus}
      </section>}

      {!answerOnlyView && <section className="sessionBar">
        <button className={sessionStartedAt ? "active" : ""} onClick={toggleSession}>
          <Power size={15} />
          {sessionStartedAt ? formatElapsed(sessionElapsedSeconds) : "Start"}
        </button>
        <button onClick={clearSession}>
          <RotateCcw size={15} />
          Clear all
        </button>
        <button onClick={exportSession}>
          <Download size={15} />
          Export
        </button>
        <span>Shortcuts: Ctrl+Alt+C context · D detect · A audio · K copy · P click-through</span>
      </section>}

      {sessionStatus && !answerOnlyView && <section className="sessionStatus">{sessionStatus}</section>}

      {!answerOnlyView && (
        <section className="viewSwitcher" aria-label="View mode">
          <button className={viewMode === "full" ? "selected" : ""} onClick={() => setModeView("full")}>Full</button>
          <button className={viewMode === "glass" ? "selected" : ""} onClick={() => setModeView("glass")}>Glass</button>
          <button onClick={() => setModeView("stealth")}>Stealth</button>
          <button onClick={() => setModeView("focus")}>Focus</button>
        </section>
      )}

      {answerOnlyView ? (
        <section className="stealthAnswer">
          <div className="stealthMeta">
            <span className={status === "ready" ? "dot ok" : "dot"} />
            <span>{status === "analyzing" ? "Analyzing" : status === "capturing" ? "Capturing" : mode}</span>
            <button title="Analyze" onClick={() => analyze(transcriptRef.current, modeRef.current, "manual", screenContextRef.current)} disabled={status === "analyzing" || status === "capturing"}>Analyze</button>
            <button title="Switch to full view" onClick={() => setModeView("full")}>Full</button>
          </div>
          <pre>{status === "analyzing" ? "Reading screen and transcript..." : status === "capturing" ? "Capturing screen context..." : answer}</pre>
        </section>
      ) : null}

      {!compact && !answerOnlyView && <section className="statusStrip">
        <span className={teamsStatus?.detected ? "dot ok" : "dot"} />
        <span>{teamsStatus?.message ?? "Checking Microsoft Teams..."}</span>
      </section>}

      {!answerOnlyView && <section className="modeBar" aria-label="Assistant mode">
        <button className={mode === "coding" ? "selected" : ""} onClick={() => setMode("coding")}>Coding</button>
        <button className={mode === "behavioral" ? "selected" : ""} onClick={() => setMode("behavioral")}>Behavioral</button>
        <button className={mode === "meeting" ? "selected" : ""} onClick={() => setMode("meeting")}>Meeting</button>
      </section>}

      {!answerOnlyView && <section className="controls">
        <button className="primary" onClick={() => analyze(transcriptRef.current, modeRef.current, "manual", screenContextRef.current)} disabled={status === "analyzing" || status === "capturing"}>
          <Sparkles size={17} />
          Analyze
        </button>
        <button onClick={analyzeTranscriptOnly} disabled={status === "analyzing" || status === "capturing"}>
          Audio Q
        </button>
        <button onClick={addScreenContext} disabled={status === "analyzing" || status === "capturing"}>
          <Clipboard size={17} />
          Context
        </button>
        <button className={autoAnalyze ? "active" : ""} onClick={() => setAutoAnalyze((enabled) => !enabled)}>
          <Timer size={17} />
          Auto
        </button>
        <button className={questionDetect ? "active" : ""} onClick={() => setQuestionDetect((enabled) => !enabled)}>
          <Search size={17} />
          Detect
        </button>
        <button className={systemAudioListening ? "active" : ""} onClick={toggleSystemAudio}>
          <Headphones size={17} />
          Audio
        </button>
        <button onClick={toggleMic}>
          {status === "listening" ? <Pause size={17} /> : <Mic size={17} />}
          {status === "listening" ? "Pause mic" : "Mic"}
        </button>
      </section>}

      {!answerOnlyView && <section className="answerPanel">
        <div className="panelHeader">
          <span>Suggestion</span>
          <div className="panelActions">
            <button title="Expand answer" onClick={() => setExpandedAnswer((expanded) => !expanded)} className="smallTextButton">
              {expandedAnswer ? "Less" : "More"}
            </button>
            <button title="Continue answer" onClick={continueAnswer} className="smallTextButton">
              Continue
            </button>
            <button title="Copy answer" onClick={copyAnswer} className="iconButton small">
              <Clipboard size={15} />
            </button>
          </div>
        </div>
        {status === "analyzing" ? (
          <div className="loader">Reading screen and transcript...</div>
        ) : status === "capturing" ? (
          <div className="loader">Capturing screen context...</div>
        ) : (
          <pre className={expandedAnswer ? "expandedAnswer" : ""}>{answer}</pre>
        )}
        {error && <p className="error">{error}</p>}
      </section>}

      {!compact && <section className="transcriptPanel">
        <div className="panelHeader">
          <span>Recent transcript</span>
          <div className="panelActions">
            <button title="Clear saved screen context" onClick={clearScreenContext} className="smallTextButton">
              Clear ctx
            </button>
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
        <span><CheckCircle2 size={14} /> {settings.provider} · STT {settings.transcriptionProvider} · {maskedKey}</span>
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
              Provider preset
              <select defaultValue="" onChange={(event) => applyProviderPreset(event.target.value as ProviderPreset)}>
                <option value="" disabled>Select preset</option>
                <option value="gemini-groq">Gemini answers + Groq transcription</option>
                <option value="openrouter-groq">OpenRouter answers + Groq transcription</option>
                <option value="openai-only">OpenAI answers + OpenAI transcription</option>
              </select>
            </label>
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
                <option value="gemini">Gemini</option>
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
              Transcription provider
              <select
                value={draftSettings.transcriptionProvider}
                onChange={(event) =>
                  setDraftSettings({
                    ...draftSettings,
                    transcriptionProvider: event.target.value as AppSettings["transcriptionProvider"]
                  })
                }
              >
                <option value="openai">OpenAI</option>
                <option value="groq">Groq</option>
              </select>
            </label>
            <label>
              OpenAI transcription model
              <input
                value={draftSettings.transcriptionModel}
                onChange={(event) => setDraftSettings({ ...draftSettings, transcriptionModel: event.target.value })}
              />
            </label>
            <label>
              Groq API keys
              <textarea
                className="keyPoolInput"
                value={draftSettings.groqApiKeys || draftSettings.groqApiKey}
                onChange={(event) =>
                  setDraftSettings({ ...draftSettings, groqApiKeys: event.target.value, groqApiKey: "" })
                }
                placeholder={"gsk_...\ngsk_..."}
              />
            </label>
            <label>
              Groq transcription model
              <input
                value={draftSettings.groqTranscriptionModel}
                onChange={(event) => setDraftSettings({ ...draftSettings, groqTranscriptionModel: event.target.value })}
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
              Gemini API keys
              <textarea
                className="keyPoolInput"
                value={draftSettings.geminiApiKeys || draftSettings.geminiApiKey}
                onChange={(event) =>
                  setDraftSettings({ ...draftSettings, geminiApiKeys: event.target.value, geminiApiKey: "" })
                }
                placeholder={"AIza...\nAIza..."}
              />
            </label>
            <label>
              Capture source
              <select
                value={draftSettings.captureSourceId}
                onFocus={refreshCaptureSources}
                onChange={(event) => setDraftSettings({ ...draftSettings, captureSourceId: event.target.value })}
              >
                <option value="">Primary screen</option>
                {captureSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.type}: {source.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={refreshCaptureSources}>Refresh capture sources</button>
            <label>
              Gemini model
              <input
                value={draftSettings.geminiModel}
                onChange={(event) => setDraftSettings({ ...draftSettings, geminiModel: event.target.value })}
              />
            </label>
            <label className="checkboxRow">
              <input
                type="checkbox"
                checked={draftSettings.sendScreenshotToGemini}
                onChange={(event) =>
                  setDraftSettings({ ...draftSettings, sendScreenshotToGemini: event.target.checked })
                }
              />
              Send screenshot to Gemini
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
      </>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
