// Single source of truth for the brain controller's Ollama model catalog.
// Imported by both the Brain Setup Wizard (src/renderer/brain-wizard/) and
// Settings → Brain (src/renderer/settings/). Keep them in sync — adding a
// new entry here surfaces it in both pickers automatically.
//
// Response-time estimates are rough CPU-only ballparks for a typical 16 GB
// laptop on our 50-token JSON-schema brain calls. Cold-load includes weights
// being read from disk into RAM. Warm response is after the model is resident.
// GPU users get roughly 10–20× faster numbers across the board.

export interface BrainModelEntry {
  /** Ollama tag, e.g. 'llama3.2:1b'. Pass to `ollama pull <tag>`. */
  tag: string;
  /** Human-readable label for picker UI. */
  label: string;
  /** Approximate download size in GB (Ollama's quantized weight file). */
  sizeGb: number;
  /** Minimum RAM in GB we'd recommend for usable inference speed. */
  minRamGb: number;
  /** Estimated cold-load + first-response time on CPU. Free-form string so
   *  we can write 'minutes' for the 70B without lying about precision. */
  coldSec: string;
  /** Estimated warm-response time (model already resident in RAM). */
  warmSec: string;
  /** One-sentence pitch for the picker UI. */
  notes: string;
}

export const BRAIN_MODEL_CATALOG: ReadonlyArray<BrainModelEntry> = [
  {
    tag: 'qwen2.5:0.5b',
    label: 'Qwen 2.5 — 0.5B',
    sizeGb: 0.4,
    minRamGb: 2,
    coldSec: '~2-4s',
    warmSec: '<0.5s',
    notes: 'Smallest viable. Borderline coherent but absolute fastest option.',
  },
  {
    tag: 'qwen2.5:1.5b',
    label: 'Qwen 2.5 — 1.5B',
    sizeGb: 1.0,
    minRamGb: 4,
    coldSec: '~3-6s',
    warmSec: '<1s',
    notes: 'Excellent at structured outputs for its size. Great speed/quality balance.',
  },
  {
    tag: 'llama3.2:1b',
    label: 'Llama 3.2 — 1B',
    sizeGb: 1.3,
    minRamGb: 4,
    coldSec: '~4-8s',
    warmSec: '<1s',
    notes: 'Near-instant. Tiny but coherent for our 5-action schema. Recommended for "instant" brain feel.',
  },
  {
    tag: 'gemma2:2b',
    label: 'Gemma 2 — 2B',
    sizeGb: 1.6,
    minRamGb: 4,
    coldSec: '~5-10s',
    warmSec: '1-2s',
    notes: 'Google\'s compact model. Plays nicely with JSON schemas.',
  },
  {
    tag: 'qwen2.5-coder:3b',
    label: 'Qwen 2.5 Coder — 3B',
    sizeGb: 1.8,
    minRamGb: 6,
    coldSec: '~6-12s',
    warmSec: '2-3s',
    notes: 'Coder-tuned but handles our small JSON schema fine. Already on your disk if you\'ve used Merlin\'s coder integrations.',
  },
  {
    tag: 'llama3.2:3b',
    label: 'Llama 3.2 — 3B',
    sizeGb: 2.0,
    minRamGb: 6,
    coldSec: '~6-12s',
    warmSec: '2-4s',
    notes: 'Sweet spot for CPU-only. Fits in 8 GB systems easily. Recommended default for new users.',
  },
  {
    tag: 'phi3:mini',
    label: 'Phi-3 Mini — 3.8B',
    sizeGb: 2.2,
    minRamGb: 8,
    coldSec: '~8-15s',
    warmSec: '2-4s',
    notes: 'Microsoft\'s compact model. Good reasoning for its size; less playful than Llama.',
  },
  {
    tag: 'mistral:7b',
    label: 'Mistral 7B',
    sizeGb: 4.1,
    minRamGb: 12,
    coldSec: '~25-50s',
    warmSec: '5-8s',
    notes: 'Solid all-rounder. Fast on a GPU, sluggish on CPU.',
  },
  {
    tag: 'qwen2.5:7b',
    label: 'Qwen 2.5 — 7B',
    sizeGb: 4.4,
    minRamGb: 14,
    coldSec: '~30-55s',
    warmSec: '5-8s',
    notes: 'Strong at structured outputs. Good fit for the brain\'s JSON-schema responses.',
  },
  {
    tag: 'qwen2.5-coder:7b-instruct',
    label: 'Qwen 2.5 Coder — 7B',
    sizeGb: 4.4,
    minRamGb: 14,
    coldSec: '~30-55s',
    warmSec: '5-8s',
    notes: 'Coder-tuned 7B. Excellent at JSON schemas. Already on your disk if you\'ve used Merlin\'s coder integrations.',
  },
  {
    tag: 'llama3.1:8b',
    label: 'Llama 3.1 — 8B',
    sizeGb: 4.7,
    minRamGb: 16,
    coldSec: '~60-80s',
    warmSec: '10-15s',
    notes: 'Stronger reasoning. Comfortable on 16 GB+ machines, but really wants a GPU for snappy ticks.',
  },
  {
    tag: 'gemma2:9b',
    label: 'Gemma 2 — 9B',
    sizeGb: 5.4,
    minRamGb: 16,
    coldSec: '~70-95s',
    warmSec: '12-18s',
    notes: 'Google 9B. Needs a GPU to feel snappy.',
  },
  {
    tag: 'llama3.3:70b',
    label: 'Llama 3.3 — 70B',
    sizeGb: 40,
    minRamGb: 64,
    coldSec: 'minutes',
    warmSec: 'minutes',
    notes: 'Only practical with a beefy GPU (24 GB+ VRAM). Massive overkill for the brain controller.',
  },
];

/** Pick the best default model for a given hardware profile. Used by the
 *  wizard's "Recommended" badge. */
export function recommendedTag(ramGb: number, hasGpu: boolean): string {
  if (hasGpu && ramGb >= 12) return 'llama3.1:8b';
  if (ramGb >= 14) return 'mistral:7b';
  if (ramGb >= 7) return 'llama3.2:3b';
  return 'llama3.2:1b';
}

/** Look up by tag. Returns undefined if the user has a model installed that
 *  isn't in the curated catalog (e.g. a custom fine-tune). */
export function findModel(tag: string): BrainModelEntry | undefined {
  return BRAIN_MODEL_CATALOG.find((m) => m.tag === tag);
}
