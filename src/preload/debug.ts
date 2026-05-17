import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type DebugApi } from '@shared/ipc-contract';
import type { AnimationName } from '@shared/animations';

const api: DebugApi = {
  play: (name: AnimationName) => {
    void ipcRenderer.invoke(IPC.spritePlay, name);
  },
  show: () => {
    void ipcRenderer.invoke(IPC.spriteShow);
  },
  hide: () => {
    void ipcRenderer.invoke(IPC.spriteHide);
  },
};

contextBridge.exposeInMainWorld('debugApi', api);
