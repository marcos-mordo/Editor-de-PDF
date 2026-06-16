import { describe, it, expect } from 'vitest';
import { diffWords, diffStats, tokenizeWords } from './word-diff';

describe('diffWords', () => {
  it('returns all-equal for identical text', () => {
    const ops = diffWords('hello world', 'hello world');
    expect(ops.every((o) => o.type === 'equal')).toBe(true);
    expect(ops.map((o) => o.text).join('')).toBe('hello world');
  });

  it('detects an added word', () => {
    const ops = diffWords('hello world', 'hello big world');
    expect(ops.some((o) => o.type === 'add' && o.text.includes('big'))).toBe(true);
    const { added, removed } = diffStats(ops);
    expect(added).toBe(1);
    expect(removed).toBe(0);
  });

  it('detects a removed word', () => {
    const ops = diffWords('hello big world', 'hello world');
    expect(ops.some((o) => o.type === 'remove' && o.text.includes('big'))).toBe(true);
    const { added, removed } = diffStats(ops);
    expect(removed).toBe(1);
  });

  it('detects a replacement as remove + add', () => {
    const ops = diffWords('the cat sat', 'the dog sat');
    expect(ops.some((o) => o.type === 'remove' && o.text.includes('cat'))).toBe(true);
    expect(ops.some((o) => o.type === 'add' && o.text.includes('dog'))).toBe(true);
  });

  it('reconstructs both sides from the ops', () => {
    const a = 'one two three four';
    const b = 'one TWO three five';
    const ops = diffWords(a, b);
    const left = ops.filter((o) => o.type !== 'add').map((o) => o.text).join('');
    const right = ops.filter((o) => o.type !== 'remove').map((o) => o.text).join('');
    expect(left).toBe(a);
    expect(right).toBe(b);
  });
});

describe('tokenizeWords', () => {
  it('keeps whitespace tokens', () => {
    expect(tokenizeWords('a  b')).toEqual(['a', '  ', 'b']);
  });
});
