import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/*.tsbuildinfo',
      'apps/api/src/generated/**',
      // scripts/ 与 apps/api/scripts/ 仅用于本地临时开发/验收，不纳入 Git，也不参与正式 lint。
      'scripts/**',
      'apps/api/scripts/**',
      // CordysCRM/ 是只读上游参考源码，不属于 MicroMatrix 的 lint 范围。
      'CordysCRM/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
    rules: {
      // .vue 内是 TypeScript，未定义变量交给 vue-tsc 检查
      // （ElMessage 等由 unplugin-auto-import 注入，类型声明在 src/types/）
      'no-undef': 'off',
    },
  },
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  prettier,
)
