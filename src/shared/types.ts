export type AssistantStatus = "idle" | "listening" | "analyzing" | "ready" | "error";

export type AppSettings = {
  provider: "openai" | "openrouter" | "gemini";
  transcriptionProvider: "openai" | "groq";
  openAiApiKey: string;
  openRouterApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  model: string;
  openRouterModel: string;
  geminiModel: string;
  sendScreenshotToOpenRouter: boolean;
  sendScreenshotToGemini: boolean;
  transcriptionModel: string;
  groqTranscriptionModel: string;
  preferredLanguage: string;
  triggerHotkey: string;
  hideHotkey: string;
  autoAnalyzeIntervalSeconds: number;
  captureMode: "screen";
};

export type AnalyzeInput = {
  transcript: string;
  mode: "coding" | "behavioral" | "meeting";
};

export type AnalyzeResult = {
  answer: string;
  screenshotDataUrl?: string;
  teamsDetected: boolean;
};

export type DesktopAudioSource = {
  id: string;
  name: string;
};

export type TranscribeAudioInput = {
  base64Audio: string;
  mimeType: string;
  source: "system" | "mic";
};

export type TranscribeAudioResult = {
  text: string;
};

export type TeamsStatus = {
  detected: boolean;
  platform: NodeJS.Platform;
  message: string;
};

export type WindowNudgeDirection = "up" | "down" | "left" | "right";
export type WindowSnapPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";
