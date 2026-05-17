import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  IPC,
  type PanelApi,
  type PanelChatTurn,
} from '@shared/ipc-contract';
import type { AnimationName } from '@shared/animations';

const api: PanelApi = {
  onAppendAssistantChunk(cb) {
    const handler = (_e: Electron.IpcRendererEvent, text: string): void => cb(text);
    ipcRenderer.on(IPC.panelAppendAssistantChunk, handler);
    return () => ipcRenderer.off(IPC.panelAppendAssistantChunk, handler);
  },
  onSetStreaming(cb) {
    const handler = (_e: Electron.IpcRendererEvent, streaming: boolean): void => cb(streaming);
    ipcRenderer.on(IPC.panelSetStreaming, handler);
    return () => ipcRenderer.off(IPC.panelSetStreaming, handler);
  },
  onAddUserTurn(cb) {
    const handler = (_e: Electron.IpcRendererEvent, text: string): void => cb(text);
    ipcRenderer.on(IPC.panelAddUserTurn, handler);
    return () => ipcRenderer.off(IPC.panelAddUserTurn, handler);
  },
  onFinalizeAssistant(cb) {
    const handler = (_e: Electron.IpcRendererEvent, text: string): void => cb(text);
    ipcRenderer.on(IPC.panelFinalizeAssistant, handler);
    return () => ipcRenderer.off(IPC.panelFinalizeAssistant, handler);
  },
  onSetSuggestions(cb) {
    const handler = (_e: Electron.IpcRendererEvent, sug: string[]): void => cb(sug);
    ipcRenderer.on(IPC.panelSetSuggestions, handler);
    return () => ipcRenderer.off(IPC.panelSetSuggestions, handler);
  },
  onOpenForAsk(cb) {
    const handler = (): void => cb();
    ipcRenderer.on(IPC.panelOpenForAsk, handler);
    return () => ipcRenderer.off(IPC.panelOpenForAsk, handler);
  },
  submit(text: string): void {
    void ipcRenderer.invoke(IPC.panelSubmit, text);
  },
  stop(): void {
    void ipcRenderer.invoke(IPC.panelStop);
  },
  regenerate(): void {
    void ipcRenderer.invoke(IPC.panelRegenerate);
  },
  getInitial: () =>
    ipcRenderer.invoke(IPC.panelGetInitial) as Promise<{
      character: string;
      history: PanelChatTurn[];
    }>,
  attachDroppedFile: (file: File) => {
    const path = webUtils.getPathForFile(file);
    if (!path) return Promise.resolve({ ok: false, error: 'no-path' } as const);
    return ipcRenderer.invoke(IPC.chatAttachFile, path) as Promise<{
      ok: boolean; name?: string; error?: string;
    }>;
  },
  transcribe: (audioBase64: string, mime: string) =>
    ipcRenderer.invoke(IPC.chatTranscribeAudio, audioBase64, mime) as Promise<string | null>,
  captureScreen: () =>
    ipcRenderer.invoke(IPC.chatCaptureScreen) as Promise<{ ok: boolean; width?: number; height?: number }>,
  getPendingScreenshot: () =>
    ipcRenderer.invoke(IPC.chatPendingScreenshot) as Promise<{ width: number; height: number; bytes: number } | null>,
  clearScreenshot: () => ipcRenderer.invoke(IPC.chatClearScreenshot) as Promise<void>,
  onPlay(cb) {
    const handler = (_e: Electron.IpcRendererEvent, name: AnimationName): void => cb(name);
    ipcRenderer.on(IPC.spritePlay, handler);
    return () => ipcRenderer.off(IPC.spritePlay, handler);
  },
  onStop(cb) {
    const handler = (): void => cb();
    ipcRenderer.on(IPC.spriteStop, handler);
    return () => ipcRenderer.off(IPC.spriteStop, handler);
  },
  onPlayAudio(cb) {
    const handler = (_e: Electron.IpcRendererEvent, dataUrl: string): void => cb(dataUrl);
    ipcRenderer.on(IPC.spritePlayAudio, handler);
    return () => ipcRenderer.off(IPC.spritePlayAudio, handler);
  },
  onStopAudio(cb) {
    const handler = (): void => cb();
    ipcRenderer.on(IPC.spriteStopAudio, handler);
    return () => ipcRenderer.off(IPC.spriteStopAudio, handler);
  },
  onSetCharacter(cb) {
    const handler = (_e: Electron.IpcRendererEvent, id: string): void => cb(id);
    ipcRenderer.on(IPC.spriteSetCharacter, handler);
    return () => ipcRenderer.off(IPC.spriteSetCharacter, handler);
  },
};

contextBridge.exposeInMainWorld('panelApi', api);
