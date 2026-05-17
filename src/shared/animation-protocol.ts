import { type AnimationName, isAnimationName } from './animations';

// Inline directives the LLM can emit, all of the form [kind:value]:
//   [anim:Greet]                 — play an animation (must be a known name)
//   [feel:cheerful]              — set Merlin's mood (must be a known mood)
//   [suggest:What time is it?]   — a clickable follow-up suggestion
//
// Values are loose strings; the parser surfaces them as typed chunks and the
// consumer validates / drops unknown values.

export const ANIM_TAG_RE = /\[anim:([A-Za-z][A-Za-z0-9_]{0,31})\]/g;
export const FEEL_TAG_RE = /\[feel:([A-Za-z][A-Za-z0-9_]{0,31})\]/g;
export const SUGGEST_TAG_RE = /\[suggest:([^\]\n]{1,200})\]/g;
// Combined regex used for streaming parse — matches any of the three forms.
const ANY_TAG_RE = /\[(anim|feel|suggest):([^\]\n]{1,200})\]/g;

export type ParsedChunk =
  | { type: 'text'; value: string }
  | { type: 'anim'; name: AnimationName }
  | { type: 'feel'; mood: string }
  | { type: 'suggest'; text: string };

const MAX_HOLDBACK = 256;

export class StreamingAnimParser {
  private buf = '';

  push(delta: string): ParsedChunk[] {
    this.buf += delta;
    const lastOpen = this.buf.lastIndexOf('[');
    let flushable: string;
    if (lastOpen === -1) {
      flushable = this.buf;
      this.buf = '';
    } else {
      const tail = this.buf.slice(lastOpen);
      // Could still be a partial tag — hold it back. The "]" terminator is
      // what tells us a tag is complete.
      const looksLikePartialTag =
        /^\[(a(n(i(m)?)?)?|f(e(e(l)?)?)?|s(u(g(g(e(s(t)?)?)?)?)?)?)?(:[^\]\n]*)?$/.test(tail);
      if (looksLikePartialTag && tail.length <= MAX_HOLDBACK) {
        flushable = this.buf.slice(0, lastOpen);
        this.buf = tail;
      } else {
        flushable = this.buf;
        this.buf = '';
      }
    }
    return this.parseSegment(flushable);
  }

  flush(): ParsedChunk[] {
    const out = this.parseSegment(this.buf);
    this.buf = '';
    return out;
  }

  private parseSegment(s: string): ParsedChunk[] {
    if (!s) return [];
    const out: ParsedChunk[] = [];
    let lastIndex = 0;
    ANY_TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ANY_TAG_RE.exec(s)) !== null) {
      if (m.index > lastIndex) {
        out.push({ type: 'text', value: s.slice(lastIndex, m.index) });
      }
      const kind = m[1]!;
      const value = m[2]!;
      if (kind === 'anim') {
        if (isAnimationName(value)) out.push({ type: 'anim', name: value });
      } else if (kind === 'feel') {
        out.push({ type: 'feel', mood: value.toLowerCase() });
      } else if (kind === 'suggest') {
        const t = value.trim();
        if (t) out.push({ type: 'suggest', text: t });
      }
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < s.length) {
      out.push({ type: 'text', value: s.slice(lastIndex) });
    }
    return out;
  }
}

export function stripAllTags(s: string): string {
  return s.replace(ANY_TAG_RE, '');
}
