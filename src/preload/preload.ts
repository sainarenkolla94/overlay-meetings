import { contextBridge, ipcRenderer } from "electron";
import type { AnalyzeInput, AppSettings } from "../shared/types.js";

contextBridge.exposeInMainWorld("overlayApi", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("settings:save", settings),
  analyzeNow: (input: AnalyzeInput) => ipcRenderer.invoke("assistant:analyze", input),
  getTeamsStatus: () => ipcRenderer.invoke("teams:status"),
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke("window:click-through", enabled),
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
