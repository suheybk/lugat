import { describe, expect, it } from 'vitest';
import cases from '../data/normalize_cases.json';
import { formKey, lemmaKey, normalize, normalizeRoot, stemCandidates } from '../src/normalize';

describe('normalize', () => {
  for (const [input, want] of cases.normalize) it(input, () => expect(normalize(input)).toBe(want));
});
describe('normalizeRoot', () => {
  for (const [input, want] of cases.root) it(input, () => expect(normalizeRoot(input)).toBe(want));
});
describe('lemmaKey', () => {
  for (const [input, want] of cases.lemma_key) it(input, () => expect(lemmaKey(input)).toBe(want));
});
describe('formKey', () => {
  for (const [input, want] of cases.form_key) it(input, () => expect(formKey(input)).toBe(want));
});
describe('stemCandidates', () => {
  it('وبالكتاب → كتاب', () => expect(stemCandidates('وبالكتاب')).toContain('كتاب'));
  it('كتابهم → كتاب', () => expect(stemCandidates('كتابهم')).toContain('كتاب'));
});
