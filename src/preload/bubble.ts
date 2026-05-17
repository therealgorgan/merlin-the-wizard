import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  IPC,
  type BubbleApi,
  type BubblePayload,
  type BubbleMode,
  type TailSide,
} from '@shared/ipc-contract';

const api: BubbleApi = {
  onSetText(cb) {
    const handler = (_e: Electron.IpcRendererEvent, payload: BubblePayload): void =>
      cb(payload);
    ipcRenderer.on(IPC.bubbleSetText, handler);
    return () => ipcRenderer.off(IPC.bubbleSetText, handler);
  },
  onAppendText(cb) {
    const handler = (_e: Electron.IpcRendererEvent, text: string): void => cb(text);
    ipcRenderer.on(IPC.bubbleAppendText, handler);
    return () => ipcRenderer.off(IPC.bubbleAppendText, handler);
  },
  onSetTailSide(cb) {
    const handler = (_e: Electron.IpcRendererEvent, side: TailSide): void => cb(side);
    ipcRenderer.on(IPC.bubbleSetTailSide, handler);
    return () => ipcRenderer.off(IPC.bubbleSetTailSide, handler);
  },
  onSetMode(cb) {
    const handler = (_e: Electron.IpcRendererEvent, mode: BubbleMode): void => cb(mode);
    ipcRenderer.on(IPC.bubbleSetMode, handler);
    return () => ipcRenderer.off(IPC.bubbleSetMode, handler);
  },
  onSetSuggestions(cb) {
    const handler = (_e: Electron.IpcRendererEvent, sug: string[]): void => cb(sug);
    ipcRenderer.on(IPC.bubbleSetSuggestions, handler);
    return () => ipcRenderer.off(IPC.bubbleSetSuggestions, handler);
  },
  submit(text: string): void {
    void ipcRenderer.invoke(IPC.bubbleSubmit, text);
  },
  dismiss(): void {
    void ipcRenderer.invoke(IPC.bubbleDismiss);
  },
  attachFile: (path: string) =>
    ipcRenderer.invoke(IPC.chatAttachFile, path) as Promise<{ ok: boolean; name?: string; error?: string }>,
  attachDroppedFile: (file: File) => {
    // Electron 32+ removed File.path. webUtils.getPathForFile is the supported replacement.
    const path = webUtils.getPathForFile(file);
    if (!path) return Promise.resolve({ ok: false, error: 'no-path' } as const);
    return ipcRenderer.invoke(IPC.chatAttachFile, path) as Promise<{ ok: boolean; name?: string; error?: string }>;
  },
  pendingCount: () => ipcRenderer.invoke(IPC.chatPendingCount) as Promise<number>,
  clearPending: () => ipcRenderer.invoke(IPC.chatClearPending) as Promise<void>,
  transcribe: (audioBase64: string, mime: string) =>
    ipcRenderer.invoke(IPC.chatTranscribeAudio, audioBase64, mime) as Promise<string | null>,
  onScreenshotReady: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, meta: { width: number; height: number; bytes: number }): void =>
      cb(meta);
    ipcRenderer.on(IPC.chatScreenshotReady, handler);
    return () => ipcRenderer.off(IPC.chatScreenshotReady, handler);
  },
  captureScreen: () =>
    ipcRenderer.invoke(IPC.chatCaptureScreen) as Promise<{ ok: boolean; width?: number; height?: number }>,
  getPendingScreenshot: () =>
    ipcRenderer.invoke(IPC.chatPendingScreenshot) as Promise<{ width: number; height: number; bytes: number } | null>,
  clearScreenshot: () => ipcRenderer.invoke(IPC.chatClearScreenshot) as Promise<void>,
};

contextBridge.exposeInMainWorld('bubbleApi', api);
