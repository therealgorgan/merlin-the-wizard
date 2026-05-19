import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type SpriteApi } from '@shared/ipc-contract';
import type { AnimationName } from '@shared/animations';

const api: SpriteApi = {
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
  onShow(cb) {
    const handler = (): void => cb();
    ipcRenderer.on(IPC.spriteShow, handler);
    return () => ipcRenderer.off(IPC.spriteShow, handler);
  },
  onHide(cb) {
    const handler = (): void => cb();
    ipcRenderer.on(IPC.spriteHide, handler);
    return () => ipcRenderer.off(IPC.spriteHide, handler);
  },
  onSetZoom(cb) {
    const handler = (_e: Electron.IpcRendererEvent, zoom: number): void => cb(zoom);
    ipcRenderer.on(IPC.spriteSetZoom, handler);
    return () => ipcRenderer.off(IPC.spriteSetZoom, handler);
  },
  onSetMuteSounds(cb) {
    const handler = (_e: Electron.IpcRendererEvent, muted: boolean): void => cb(muted);
    ipcRenderer.on(IPC.spriteSetMuteSounds, handler);
    return () => ipcRenderer.off(IPC.spriteSetMuteSounds, handler);
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
  onSetAppearance(cb) {
    const handler = (_e: Electron.IpcRendererEvent, appearance: 'classic' | 'retouched'): void =>
      cb(appearance);
    ipcRenderer.on(IPC.spriteSetAppearance, handler);
    return () => ipcRenderer.off(IPC.spriteSetAppearance, handler);
  },
  getInitial: () =>
    ipcRenderer.invoke(IPC.spriteGetInitial) as Promise<{
      zoom: number;
      muteSounds: boolean;
      character: string;
      appearance: 'classic' | 'retouched';
      extensions: Record<string, boolean | string>;
    }>,
  onSetExtensions(cb) {
    const handler = (
      _e: Electron.IpcRendererEvent,
      flags: Record<string, boolean | string>,
    ): void => cb(flags);
    ipcRenderer.on(IPC.spriteSetExtensions, handler);
    return () => ipcRenderer.off(IPC.spriteSetExtensions, handler);
  },
  reportAnimationDone(_name: AnimationName) {
    // No-op for Phase 1.
  },
  startDrag() {
    // Drag handled by -webkit-app-region: drag in the renderer CSS.
  },
  reportAudioState(active: boolean) {
    void ipcRenderer.invoke(IPC.spriteAudioStateChanged, active);
  },
};

contextBridge.exposeInMainWorld('spriteApi', api);

contextBridge.exposeInMainWorld('spriteEvents', {
  doubleClick(): void {
    void ipcRenderer.invoke(IPC.spriteDoubleClicked);
  },
  rightClick(x: number, y: number): void {
    void ipcRenderer.invoke(IPC.spriteRightClicked, { x, y });
  },
  drag(dx: number, dy: number): void {
    void ipcRenderer.invoke(IPC.windowDrag, { dx, dy });
  },
  dragEnd(): void {
    void ipcRenderer.invoke(IPC.windowDragEnd);
  },
  zoomBy(delta: number): void {
    void ipcRenderer.invoke(IPC.spriteZoomBy, delta);
  },
});
