import type { MenuItemConstructorOptions } from 'electron';
import { IPC } from '@shared/ipc-contract';
import { type AnimationName } from '@shared/animations';
import { getSpriteWindow } from './windows/spriteWindow';

const CATEGORIES: Array<{ label: string; items: AnimationName[] }> = [
  {
    label: 'Greetings & Reactions',
    items: [
      'Greet',
      'Wave',
      'Acknowledge',
      'Announce',
      'Pleased',
      'Surprised',
      'Confused',
      'Sad',
      'Uncertain',
      'DontRecognize',
      'Congratulate',
      'Congratulate_2',
      'Decline',
    ],
  },
  {
    label: 'Magic',
    items: ['DoMagic1', 'DoMagic2'],
  },
  {
    label: 'Thinking & Reading',
    items: [
      'Think',
      'Thinking',
      'Process',
      'Processing',
      'Read',
      'Reading',
      'ReadContinued',
      'ReadReturn',
      'Search',
      'Searching',
      'Write',
      'Writing',
      'WriteContinued',
      'WriteReturn',
    ],
  },
  {
    label: 'Gestures',
    items: [
      'GestureLeft',
      'GestureRight',
      'GestureUp',
      'GestureDown',
      'Explain',
      'Suggest',
      'Alert',
    ],
  },
  {
    label: 'Looking',
    items: [
      'LookLeft',
      'LookLeftBlink',
      'LookLeftReturn',
      'LookRight',
      'LookRightBlink',
      'LookRightReturn',
      'LookUp',
      'LookUpBlink',
      'LookUpReturn',
      'LookDown',
      'LookDownBlink',
      'LookDownReturn',
    ],
  },
  {
    label: 'Moving',
    items: ['MoveLeft', 'MoveRight', 'MoveUp', 'MoveDown'],
  },
  {
    label: 'Listening',
    items: [
      'StartListening',
      'StopListening',
      'Hearing_1',
      'Hearing_2',
      'Hearing_3',
      'Hearing_4',
    ],
  },
  {
    label: 'Idle',
    items: [
      'RestPose',
      'Blink',
      'Idle1_1',
      'Idle1_2',
      'Idle1_3',
      'Idle1_4',
      'Idle2_1',
      'Idle2_2',
      'Idle3_1',
      'Idle3_2',
    ],
  },
  {
    label: 'Attention & Visibility',
    items: [
      'GetAttention',
      'GetAttentionContinued',
      'GetAttentionReturn',
      'Show',
      'Hide',
    ],
  },
];

function playFromMenu(name: AnimationName): void {
  const w = getSpriteWindow();
  w?.webContents.send(IPC.spritePlay, name);
}

export function buildAnimationSubmenu(): MenuItemConstructorOptions[] {
  return CATEGORIES.map((cat) => ({
    label: cat.label,
    submenu: cat.items.map(
      (a): MenuItemConstructorOptions => ({
        label: a,
        click: () => playFromMenu(a),
      }),
    ),
  }));
}
