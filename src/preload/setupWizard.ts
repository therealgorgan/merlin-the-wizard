import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type SetupWizardApi,
  type StoreSnapshot,
  type ProviderInfoForUi,
  type CharacterForUi,
} from '@shared/ipc-contract';

const api: SetupWizardApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<StoreSnapshot>,
  set: (patch) =>
    ipcRenderer.invoke(IPC.settingsSet, patch) as Promise<StoreSnapshot>,
  getProviders: () =>
    ipcRenderer.invoke(IPC.settingsGetProviderInfo) as Promise<ProviderInfoForUi[]>,
  getCharacters: () =>
    ipcRenderer.invoke(IPC.settingsGetCharacters) as Promise<CharacterForUi[]>,
  setSecret: (name, value) =>
    ipcRenderer.invoke(IPC.secretsSet, name, value) as Promise<void>,
  hasSecret: (name) =>
    ipcRenderer.invoke(IPC.secretsHas, name) as Promise<boolean>,
  openExternal: (url) =>
    ipcRenderer.invoke(IPC.secretsOpenLink, url) as Promise<void>,
  complete: () =>
    ipcRenderer.invoke(IPC.setupWizardComplete) as Promise<void>,
  close: () => {
    void ipcRenderer.invoke(IPC.setupWizardClose);
  },
  openBrainWizard: () =>
    ipcRenderer.invoke(IPC.brainWizardOpen) as Promise<void>,
};

contextBridge.exposeInMainWorld('setupWizardApi', api);
