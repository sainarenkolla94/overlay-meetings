export type AssistantStatus = "idle" | "listening" | "analyzing" | "ready" | "error";

export type AppSettings = {
  openAiApiKey: string;
  model: string;
  transcriptionModel: string;
  preferredLanguage: string;
  triggerHotkey: string;
  hideHotkey: string;
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

export type TeamsStatus = {
  detected: boolean;
  platform: NodeJS.Platform;
  message: string;
};
