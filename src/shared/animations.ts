export const ANIMATIONS = [
  'Acknowledge',
  'Alert',
  'Announce',
  'Blink',
  'Confused',
  'Congratulate',
  'Congratulate_2',
  'Decline',
  'DoMagic1',
  'DoMagic2',
  'DontRecognize',
  'Explain',
  'GestureDown',
  'GestureLeft',
  'GestureRight',
  'GestureUp',
  'GetAttention',
  'GetAttentionContinued',
  'GetAttentionReturn',
  'Greet',
  'Hearing_1',
  'Hearing_2',
  'Hearing_3',
  'Hearing_4',
  'Hide',
  'Idle1_1',
  'Idle1_2',
  'Idle1_3',
  'Idle1_4',
  'Idle2_1',
  'Idle2_2',
  'Idle3_1',
  'Idle3_2',
  'LookDown',
  'LookDownBlink',
  'LookDownReturn',
  'LookLeft',
  'LookLeftBlink',
  'LookLeftReturn',
  'LookRight',
  'LookRightBlink',
  'LookRightReturn',
  'LookUp',
  'LookUpBlink',
  'LookUpReturn',
  'MoveDown',
  'MoveLeft',
  'MoveRight',
  'MoveUp',
  'Pleased',
  'Process',
  'Processing',
  'Read',
  'ReadContinued',
  'ReadReturn',
  'Reading',
  'RestPose',
  'Sad',
  'Search',
  'Searching',
  'Show',
  'StartListening',
  'StopListening',
  'Suggest',
  'Surprised',
  'Think',
  'Thinking',
  'Uncertain',
  'Wave',
  'Write',
  'WriteContinued',
  'WriteReturn',
  'Writing',
] as const;

export type AnimationName = (typeof ANIMATIONS)[number];

const ANIMATION_SET: ReadonlySet<string> = new Set(ANIMATIONS);
export function isAnimationName(value: string): value is AnimationName {
  return ANIMATION_SET.has(value);
}

// Animations that cause clippyjs's agent.stop() to be called inside enqueue,
// halting the current sprite-frame animation immediately. Use sparingly —
// agent.stop() followed by agent.play() in the same tick leaves clippyjs in a
// bad state for some animations (see ClippyController.enqueue handling).
export const PREEMPTING_ANIMATIONS: ReadonlySet<AnimationName> = new Set([
  'Hide',
  'Show',
  'GetAttention',
] as const);

// Animations that should jump the queue (clear pending) but should NOT call
// agent.stop() — they wait for the current animation to finish naturally,
// then play. Useful for animations that are urgent in the "user expects to
// see this soon" sense but not "stop everything right now."
export const SOFT_PREEMPTING_ANIMATIONS: ReadonlySet<AnimationName> = new Set([
  'MoveLeft',
  'MoveRight',
  'MoveUp',
  'MoveDown',
] as const);

export const IDLE_ANIMATIONS: readonly AnimationName[] = [
  'Idle1_1',
  'Idle1_2',
  'Idle1_3',
  'Idle1_4',
  'Idle2_1',
  'Idle2_2',
  'Idle3_1',
  'Idle3_2',
  'Blink',
  'LookLeft',
  'LookRight',
];
