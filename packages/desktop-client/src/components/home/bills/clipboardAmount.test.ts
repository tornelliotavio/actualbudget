import { amountForClipboard } from './clipboardAmount';

describe('amountForClipboard', () => {
  it('uses the locale decimal separator without grouping', () => {
    expect(amountForClipboard(140753, 'pt-BR')).toBe('1407,53');
    expect(amountForClipboard(140753, 'en-US')).toBe('1407.53');
    expect(amountForClipboard(-500, 'pt-BR')).toBe('5,00');
  });
});
