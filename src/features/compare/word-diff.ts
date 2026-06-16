/**
 * Word-level diff via the classic Longest Common Subsequence. Used to compare
 * the text of two PDFs and highlight what was added or removed.
 */

export type DiffOp =
  | { type: 'equal'; text: string }
  | { type: 'add'; text: string }
  | { type: 'remove'; text: string };

/** Split into words while keeping whitespace runs as their own tokens. */
export function tokenizeWords(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

export function diffWords(a: string, b: string): DiffOp[] {
  const A = tokenizeWords(a);
  const B = tokenizeWords(b);
  const n = A.length;
  const m = B.length;

  // LCS table (rolling could save memory; n,m are page-sized so this is fine).
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        A[i] === B[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  function push(type: DiffOp['type'], text: string) {
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text } as DiffOp);
  }
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      push('equal', A[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('remove', A[i]);
      i++;
    } else {
      push('add', B[j]);
      j++;
    }
  }
  while (i < n) push('remove', A[i++]);
  while (j < m) push('add', B[j++]);
  return ops;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffStats(ops: DiffOp[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    const words = op.text.trim() ? op.text.trim().split(/\s+/).length : 0;
    if (op.type === 'add') added += words;
    else if (op.type === 'remove') removed += words;
  }
  return { added, removed };
}
