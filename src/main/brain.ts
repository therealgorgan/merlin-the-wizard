// brain.ts is now a back-compat shim. The autonomous loop logic moved into
// src/main/brainControllers/defaultBrain.ts (the 'default' controller). The
// supervisor in src/main/brainSupervisor.ts owns the active controller and
// re-exports the legacy API.

export {
  markInteraction,
  noteIdleThoughtDismissed,
  startActiveBrain as startBrain,
  stopActiveBrain as stopBrain,
} from './brainSupervisor';
