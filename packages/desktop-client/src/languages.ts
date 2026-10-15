export const languages = import.meta.glob([
  '/locale/*.json',
  '!/locale/*_old.json',
]);

/**
 * Translations of strings only this fork has. Upstream translations are
 * cloned at build time and know nothing of them; these win over upstream.
 */
export const forkLanguages = import.meta.glob(['/locale-fork/*.json']);
