import { promises as fsp } from 'node:fs';
import { basename, extname } from 'node:path';
import { logger } from './logger';

// Pending attachments queue — files the user has dropped onto Merlin since
// their last submitted prompt. handleUserMessage drains this and prepends
// the file contents to the user's text.

export interface Attachment {
  name: string;
  ext: string;
  size: number;
  text: string;
  truncated: boolean;
}

const TEXT_EXTS = new Set([
  '.txt', '.md', '.mdx', '.markdown',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.env',
  '.csv', '.tsv',
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.php', '.scala', '.lua', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.xml', '.svg',
  '.sql', '.graphql', '.proto',
  '.log',
  '.gitignore', '.dockerignore',
]);

const MAX_FILE_BYTES = 256 * 1024; // 256 KB per file
const MAX_TOTAL_BYTES = 1024 * 1024; // 1 MB total across pending attachments

let pending: Attachment[] = [];

export function getPending(): Attachment[] {
  return pending.slice();
}

export function clearPending(): void {
  pending = [];
}

export function pendingCount(): number {
  return pending.length;
}

export type AttachResult =
  | { ok: true; attachment: Attachment }
  | { ok: false; error: string };

export async function attachFile(path: string): Promise<AttachResult> {
  try {
    const stat = await fsp.stat(path);
    if (!stat.isFile()) {
      logger.warn('attachFile: not a regular file:', path);
      return { ok: false, error: 'not a file' };
    }
    const ext = extname(path).toLowerCase();
    const name = basename(path);
    if (!TEXT_EXTS.has(ext)) {
      logger.warn('attachFile: unsupported file type', ext, name);
      return { ok: false, error: `unsupported type ${ext || '(none)'}` };
    }
    const totalSoFar = pending.reduce((s, a) => s + a.size, 0);
    if (totalSoFar + stat.size > MAX_TOTAL_BYTES) {
      logger.warn('attachFile: would exceed total attachment budget');
      return { ok: false, error: 'attachment budget exceeded' };
    }
    const buf = await fsp.readFile(path);
    const truncated = buf.length > MAX_FILE_BYTES;
    const text = truncated
      ? buf.subarray(0, MAX_FILE_BYTES).toString('utf-8') + '\n\n[...file truncated...]'
      : buf.toString('utf-8');
    const att: Attachment = { name, ext, size: stat.size, text, truncated };
    pending.push(att);
    logger.info('attached:', name, stat.size, 'bytes', truncated ? '(truncated)' : '');
    return { ok: true, attachment: att };
  } catch (err) {
    logger.warn('attachFile failed', path, err);
    return { ok: false, error: err instanceof Error ? err.message : 'read failed' };
  }
}

/** Build a text preamble that prepends attachment contents to the user's */
/** prompt, then clears the pending queue. */
export function consumePendingAttachments(userText: string): string {
  if (pending.length === 0) return userText;
  const blocks = pending
    .map((a) => `[Attached file: ${a.name}]\n\`\`\`\n${a.text}\n\`\`\``)
    .join('\n\n');
  pending = [];
  return `${blocks}\n\n${userText}`;
}
