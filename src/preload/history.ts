import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipc-contract';

contextBridge.exposeInMainWorld('historyApi', {
  getHistory: () =>
    ipcRenderer.invoke(IPC.chatHistory) as Promise<
      Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>
    >,
});
