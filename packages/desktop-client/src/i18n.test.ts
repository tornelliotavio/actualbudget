import i18n from 'i18next';

import { availableLanguages, loadLanguage, setI18NextLanguage } from './i18n';

vi.mock('i18next', () => {
  const i18nMock = {
    use: vi.fn().mockReturnThis(),
    init: vi.fn().mockResolvedValue(undefined),
    changeLanguage: vi.fn(),
  };
  return {
    default: i18nMock,
  };
});

vi.mock('./languages', () => ({
  languages: {
    '/locale/en.json': vi.fn(),
    '/locale/uk.json': vi.fn(),
    '/locale/pt-BR.json': vi.fn(async () => ({
      default: { Budget: 'Orçamento', Reports: 'Relatórios' },
    })),
  },
  forkLanguages: {
    '/locale-fork/pt-BR.json': vi.fn(async () => ({
      default: { Overview: 'Painel', Reports: 'Relatórios do fork' },
    })),
    '/locale-fork/eo.json': vi.fn(async () => ({
      default: { Overview: 'Superrigardo' },
    })),
  },
}));

vi.hoisted(vi.resetModules);

describe('setI18NextLanguage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  afterEach(vi.unstubAllGlobals);

  test('should set system default language when no language is provided', () => {
    vi.stubGlobal('navigator', { language: 'uk' });

    setI18NextLanguage('');

    expect(vi.mocked(i18n).changeLanguage).toHaveBeenCalledWith('uk');
  });

  test('should set the provided language if it is available', () => {
    const language = availableLanguages[0];

    setI18NextLanguage(language);

    expect(vi.mocked(i18n).changeLanguage).toHaveBeenCalledWith(language);
  });

  test('should fallback to English if the provided language is unavailable', () => {
    vi.spyOn(console, 'info');

    setI18NextLanguage('unknown');

    expect(console.info).toHaveBeenCalledWith(
      'Unknown locale unknown, falling back to en',
    );
    expect(vi.mocked(i18n).changeLanguage).toHaveBeenCalledWith('en');
  });

  test('should successfully use a language with a region code if it is known', () => {
    const language = 'pt-BR';

    setI18NextLanguage(language);

    expect(vi.mocked(i18n).changeLanguage).toHaveBeenCalledWith(language);
  });

  test('should fallback to base language if the provided language has an unknown region code', () => {
    vi.spyOn(console, 'info');

    setI18NextLanguage('uk-ZZ');

    expect(console.info).toHaveBeenCalledWith(
      'Unknown locale uk-ZZ, falling back to uk-zz',
    );
    expect(vi.mocked(i18n).changeLanguage).toHaveBeenCalledWith('uk');
  });

  test('should fallback to lowercase language if the provided language has uppercase letters', () => {
    vi.spyOn(console, 'info');

    setI18NextLanguage('EN');

    expect(console.info).toHaveBeenCalledWith(
      'Unknown locale EN, falling back to en',
    );
    expect(vi.mocked(i18n).changeLanguage).toHaveBeenCalledWith('en');
  });
});

describe('loadLanguage', () => {
  test('merges the fork translations over upstream', async () => {
    expect(await loadLanguage('pt-BR')).toEqual({
      Budget: 'Orçamento',
      Overview: 'Painel',
      Reports: 'Relatórios do fork',
    });
  });

  test('offers a language only the fork translates', async () => {
    expect(availableLanguages).toContain('eo');
    expect(await loadLanguage('eo')).toEqual({ Overview: 'Superrigardo' });
  });
});
