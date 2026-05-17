// Fallback parser for llama-style inline tool calls. When the model emits
// <function=name>{"arg":"val"}</function> in plain text (instead of using the
// native tools channel), this catches them and lets us dispatch manually.
//
// Also recognizes the `<|python_tag|>name.call(args)` variant llama sometimes
// uses, just in case.

export interface FunctionCall {
  name: string;
  args: unknown;
}

export interface FunctionParseResult {
  text: string;
  calls: FunctionCall[];
}

const FUNCTION_TAG_RE = /<function=([A-Za-z_][A-Za-z_0-9]*)>([\s\S]*?)<\/function>/g;
const FN_OPEN = '<function=';
const MAX_HOLDBACK = 4096; // generous — JSON args can be long

export class FunctionCallParser {
  private buf = '';

  push(chunk: string): FunctionParseResult {
    this.buf += chunk;
    const calls: FunctionCall[] = [];
    let cleanText = '';

    FUNCTION_TAG_RE.lastIndex = 0;
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = FUNCTION_TAG_RE.exec(this.buf)) !== null) {
      cleanText += this.buf.slice(lastEnd, m.index);
      const name = m[1]!;
      const raw = m[2]!.trim();
      let args: unknown = {};
      if (raw) {
        try {
          args = JSON.parse(raw);
        } catch {
          // Malformed JSON — keep going with empty args. The handler will say
          // "missing required arg" which is better than a parse crash.
          args = {};
        }
      }
      calls.push({ name, args });
      lastEnd = m.index + m[0].length;
    }

    const remaining = this.buf.slice(lastEnd);
    let holdAt = -1;

    // (a) If we've already seen the opening "<function=" but the closing
    // "</function>" hasn't streamed in yet, hold from the open. (Regex would
    // have matched if it were closed.) This is the case where a chunk arrives
    // with "<function=move_to>{...}</" -- the LAST '<' is in "</" which is
    // NOT a prefix of "<function=", so a last-'<' search would wrongly flush.
    const openIdx = remaining.indexOf(FN_OPEN);
    if (openIdx !== -1 && remaining.length - openIdx <= MAX_HOLDBACK) {
      holdAt = openIdx;
    }

    // (b) Otherwise check if remaining ends with a partial prefix of
    // "<function=" -- e.g. chunk ends with "<", "<f", "<function". Hold the
    // partial so we can resume matching when the rest arrives.
    if (holdAt === -1) {
      const maxPrefix = Math.min(FN_OPEN.length, remaining.length);
      for (let n = maxPrefix; n > 0; n--) {
        if (remaining.endsWith(FN_OPEN.slice(0, n))) {
          holdAt = remaining.length - n;
          break;
        }
      }
    }

    if (holdAt >= 0) {
      cleanText += remaining.slice(0, holdAt);
      this.buf = remaining.slice(holdAt);
    } else {
      cleanText += remaining;
      this.buf = '';
    }

    return { text: cleanText, calls };
  }

  flush(): FunctionParseResult {
    // Any leftover at flush time is incomplete; treat as text rather than
    // dropping the user's content. (Unclosed <function> is rare in practice.)
    const text = this.buf;
    this.buf = '';
    return { text, calls: [] };
  }
}
