import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  type BrainWizardApi,
  type HardwareInfo,
  type OllamaProbeResult,
  type OllamaPullProgress,
  type OllamaTestResult,
  type HermesProbeResult,
  type BrainApplyConfig,
  type StoreSnapshot,
} from '@shared/ipc-contract';

const api: BrainWizardApi = {
  detectHardware: () =>
    ipcRenderer.invoke(IPC.brainWizardDetectHardware) as Promise<HardwareInfo>,
  scanForOllama: () =>
    ipcRenderer.invoke(IPC.brainWizardScanForOllama) as Promise<
      import('@shared/ipc-contract').OllamaScanResult
    >,
  probeOllama: (endpoint) =>
    ipcRenderer.invoke(IPC.brainWizardProbeOllama, endpoint) as Promise<OllamaProbeResult>,
  listOllamaModels: (endpoint) =>
    ipcRenderer.invoke(IPC.brainWizardListOllamaModels, endpoint) as Promise<
      OllamaProbeResult['installedModels']
    >,
  pullOllamaModel: (model, endpoint) =>
    ipcRenderer.invoke(IPC.brainWizardPullOllamaModel, model, endpoint) as Promise<{
      pullId: string;
    }>,
  cancelPull: (pullId) =>
    ipcRenderer.invoke(IPC.brainWizardCancelPull, pullId) as Promise<void>,
  onPullProgress: (cb) => {
    const handler = (_e: unknown, ev: OllamaPullProgress): void => cb(ev);
    ipcRenderer.on(IPC.brainWizardPullProgress, handler);
    return () => ipcRenderer.off(IPC.brainWizardPullProgress, handler);
  },
  testOllamaModel: (model, endpoint) =>
    ipcRenderer.invoke(IPC.brainWizardTestOllamaModel, model, endpoint) as Promise<OllamaTestResult>,
  probeHermes: (endpoint, apiKey) =>
    ipcRenderer.invoke(IPC.brainWizardProbeHermes, endpoint, apiKey) as Promise<HermesProbeResult>,
  apply: (cfg: BrainApplyConfig) =>
    ipcRenderer.invoke(IPC.brainWizardApply, cfg) as Promise<void>,
  openExternal: (url) =>
    ipcRenderer.invoke(IPC.secretsOpenLink, url) as Promise<void>,
  close: () => {
    void ipcRenderer.invoke(IPC.brainWizardClose);
  },
  getSnapshot: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<StoreSnapshot>,
  setSecret: (name, value) =>
    ipcRenderer.invoke(IPC.secretsSet, name, value) as Promise<void>,
  hasSecret: (name) =>
    ipcRenderer.invoke(IPC.secretsHas, name) as Promise<boolean>,
};

contextBridge.exposeInMainWorld('brainWizardApi', api);
