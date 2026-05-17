// Splits a streaming text feed into sentences. Emits complete sentences as
// soon as their terminating punctuation appears, holding back any trailing
// partial sentence in the buffer. Avoids tripping on common abbreviations.

const ABBREVS: ReadonlySet<string> = new Set([
  'mr',
  'mrs',
  'ms',
  'dr',
  'st',
  'jr',
  'sr',
  'vs',
  'etc',
  'e.g',
  'i.e',
  'fig',
  'no',
  'inc',
  'ltd',
]);

const SENTENCE_END = /[.!?]/;
const MIN_SENTENCE_LEN = 2;

export class SentenceSplitter {
  private buf = '';

  push(text: string): string[] {
    this.buf += text;
    const out: string[] = [];
    let i = 0;
    let lastEnd = 0;
    while (i < this.buf.length) {
      const c = this.buf[i]!;
      if (SENTENCE_END.test(c)) {
        // Look at next char; if it's whitespace or end-of-buffer-with-more-coming,
        // candidate boundary. We can't safely split unless next char exists; if
        // we're at end of buffer, hold back (next push may continue the word).
        const next = this.buf[i + 1];
        if (next !== undefined && /\s/.test(next)) {
          // Avoid splitting on abbreviations: walk back to find the preceding
          // word and check.
          const sentence = this.buf.slice(lastEnd, i + 1);
          const beforeWord = sentence.match(/(\w+)\W*$/)?.[1]?.toLowerCase() ?? '';
          if (ABBREVS.has(beforeWord)) {
            // Not a sentence boundary — skip.
            i++;
            continue;
          }
          const trimmed = sentence.trim();
          if (trimmed.length >= MIN_SENTENCE_LEN) {
            out.push(trimmed);
          }
          lastEnd = i + 1;
        }
      }
      i++;
    }
    this.buf = this.buf.slice(lastEnd);
    return out;
  }

  flush(): string {
    const rem = this.buf.trim();
    this.buf = '';
    return rem;
  }
}
