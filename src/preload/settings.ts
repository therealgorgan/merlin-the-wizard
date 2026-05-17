import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type CharacterForUi,
  type SettingsApi,
  type StoreSnapshot,
  type ProviderInfoForUi,
  type SapiVoiceForUi,
} from '@shared/ipc-contract';

const api: SettingsApi = {
  get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<StoreSnapshot>,
  set: (patch) =>
    ipcRenderer.invoke(IPC.settingsSet, patch) as Promise<StoreSnapshot>,
  getProviders: () =>
    ipcRenderer.invoke(IPC.settingsGetProviderInfo) as Promise<ProviderInfoForUi[]>,
  getSapiVoices: () =>
    ipcRenderer.invoke(IPC.settingsGetSapiVoices) as Promise<SapiVoiceForUi[]>,
  setSecret: (name, key) =>
    ipcRenderer.invoke(IPC.secretsSet, name, key) as Promise<void>,
  hasSecret: (name) =>
    ipcRenderer.invoke(IPC.secretsHas, name) as Promise<boolean>,
  clearSecret: (name) =>
    ipcRenderer.invoke(IPC.secretsClear, name) as Promise<void>,
  openExternal: (url) =>
    ipcRenderer.invoke(IPC.secretsOpenLink, url) as Promise<void>,
  close: () => {
    void ipcRenderer.invoke(IPC.settingsClose);
  },
  getCharacters: () =>
    ipcRenderer.invoke(IPC.settingsGetCharacters) as Promise<CharacterForUi[]>,
  reloadCharacters: () =>
    ipcRenderer.invoke(IPC.settingsReloadCharacters) as Promise<CharacterForUi[]>,
  openCharactersFolder: () =>
    ipcRenderer.invoke(IPC.settingsOpenCharactersFolder) as Promise<void>,
  discoverHermesModels: () =>
    ipcRenderer.invoke(IPC.settingsDiscoverHermesModels) as Promise<string[]>,
  discoverAllHermesProfiles: () =>
    ipcRenderer.invoke(IPC.settingsDiscoverAllHermesProfiles) as Promise<
      { name: string; url: string }[]
    >,
  getHermesProfiles: () =>
    ipcRenderer.invoke(IPC.settingsGetHermesProfiles) as Promise<
      { name: string; url: string }[]
    >,
  setHermesProfile: (profile) =>
    ipcRenderer.invoke(IPC.settingsSetHermesProfile, profile) as Promise<void>,
};

contextBridge.exposeInMainWorld('settingsApi', api);
