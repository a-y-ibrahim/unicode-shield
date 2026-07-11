import requireSanitizedText from './rules/require-sanitized-text'

/**
 * ESLint flat-config plugin. Usage:
 *
 *   import unicodeShield from 'unicode-shield/eslint-plugin'
 *
 *   export default [
 *     {
 *       plugins: {'unicode-shield': unicodeShield},
 *       rules: {'unicode-shield/require-sanitized-text': 'warn'},
 *     },
 *   ]
 */
const plugin = {
  rules: {
    'require-sanitized-text': requireSanitizedText,
  },
}

export default plugin
