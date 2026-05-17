// Curated short-list of popular Microsoft Edge neural voices. The Edge service
// supports ~300 voices in many languages; surface the common English ones in
// the UI and let advanced users override via the underlying voiceName field.

export interface EdgeVoiceOption {
  id: string;
  label: string;
}

export const EDGE_VOICES: EdgeVoiceOption[] = [
  { id: 'en-US-AriaNeural', label: 'Aria — US English, female, conversational' },
  { id: 'en-US-GuyNeural', label: 'Guy — US English, male, conversational' },
  { id: 'en-US-JennyNeural', label: 'Jenny — US English, female, friendly' },
  { id: 'en-US-ChristopherNeural', label: 'Christopher — US English, male, deep' },
  { id: 'en-US-EricNeural', label: 'Eric — US English, male' },
  { id: 'en-US-MichelleNeural', label: 'Michelle — US English, female' },
  { id: 'en-US-RogerNeural', label: 'Roger — US English, male' },
  { id: 'en-US-SteffanNeural', label: 'Steffan — US English, male, professional' },
  { id: 'en-GB-LibbyNeural', label: 'Libby — UK English, female' },
  { id: 'en-GB-RyanNeural', label: 'Ryan — UK English, male' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia — UK English, female' },
  { id: 'en-AU-NatashaNeural', label: 'Natasha — Australian, female' },
  { id: 'en-AU-WilliamNeural', label: 'William — Australian, male' },
  { id: 'en-IE-EmilyNeural', label: 'Emily — Irish, female' },
  { id: 'en-IE-ConnorNeural', label: 'Connor — Irish, male' },
  { id: 'en-CA-ClaraNeural', label: 'Clara — Canadian, female' },
  { id: 'en-CA-LiamNeural', label: 'Liam — Canadian, male' },
];

export const DEFAULT_EDGE_VOICE = 'en-GB-RyanNeural';
