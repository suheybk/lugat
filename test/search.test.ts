import { describe, expect, it } from 'vitest';
import { fillTemplate, vocCore } from '../src/search';
import { toBuckwalter, toLatin, toPlainLatin } from '../src/translit';

describe('vocCore', () => {
  it('tenvin farkı aynı kelime', () => expect(vocCore('رَحْمَة')).toBe(vocCore('رَحْمَةٌ')));
  it('üstün elif = elif', () => expect(vocCore('رَحْمٰن')).toBe(vocCore('رَحْمَانٌ')));
  it('farklı okuyuş farklı kelime', () => expect(vocCore('رَحَمَةٌ')).not.toBe(vocCore('رَحْمَة')));
});

describe('translit', () => {
  it.each([
    ['كِتَاب', 'kitâb'],
    ['رَحْمَة', 'raḥme'],
    ['عِلْم', 'ʿilm'],
    ['ٱلرَّحْمَٰن', 'er-raḥmân'],
    ['ٱلْكِتَٰب', 'el-kitâb'],
    ['إِيمَان', 'îmân'],
    ['حَقّ', 'ḥaḳḳ'],
    ['قُرْآن', 'ḳurʾân'],
  ])('%s → %s', (ar, lat) => expect(toLatin(ar)).toBe(lat));
  it('sade Latin', () => expect(toPlainLatin('رَحْمَة')).toBe('rahme'));
  it('Buckwalter', () => expect(toBuckwalter('كتب')).toBe('ktb'));
  it('şablon', () => expect(fillTemplate('https://x/{r_bw}/{w}', 'كِتَاب', 'كتب')).toBe('https://x/ktb/' + encodeURIComponent('كتاب')));
});
