import { contextBridge, ipcRenderer } from "electron";
import type {
  AnalyzeInput,
  AppSettings,
  TranscribeAudioInput,
  WindowNudgeDirection,
  WindowSnapPosition
} from "../shared/types.js";

contextBridge.exposeInMainWorld("overlayApi", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("settings:save", settings),
  analyzeNow: (input: AnalyzeInput) => ipcRenderer.invoke("assistant:analyze", input),
  getCaptureSources: () => ipcRenderer.invoke("capture:sources"),
  getDesktopAudioSources: () => ipcRenderer.invoke("audio:sources"),
  transcribeAudio: (input: TranscribeAudioInput) => ipcRenderer.invoke("audio:transcribe", input),
  getTeamsStatus: () => ipcRenderer.invoke("teams:status"),
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke("window:click-through", enabled),
  setResizable: (enabled: boolean) => ipcRenderer.invoke("window:resizable", enabled),
  setCompact: (enabled: boolean) => ipcRenderer.invoke("window:compact", enabled),
  nudgeWindow: (direction: WindowNudgeDirection, amount?: number) => ipcRenderer.invoke("window:nudge", direction, amount),
  snapWindow: (position: WindowSnapPosition) => ipcRenderer.invoke("window:snap", position),
  hideOverlay: () => ipcRenderer.invoke("window:hide"),
  onAnalyzeShortcut: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:analyze", listener);
    return () => ipcRenderer.removeListener("shortcut:analyze", listener);
  },
  onToggleVisibility: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("shortcut:toggle-visibility", listener);
    return () => ipcRenderer.removeListener("shortcut:toggle-visibility", listener);
  }
});
