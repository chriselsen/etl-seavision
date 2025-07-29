import tseslint from 'typescript-eslint';

export default tseslint.config(
    ...tseslint.configs.recommended,
    {
        ignores: ["ais-proxy/**", "**/*.d.ts"],
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
            '@typescript-eslint/no-explicit-any': 'off'
        }
    }
);