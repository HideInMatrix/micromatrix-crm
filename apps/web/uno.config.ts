import { defineConfig, presetWind4 } from 'unocss'

export default defineConfig({
  // presetWind4 提供 Tailwind CSS v4 兼容的工具类语法
  presets: [presetWind4()],
  shortcuts: {
    'flex-center': 'flex items-center justify-center',
    'flex-between': 'flex items-center justify-between',
  },
})
