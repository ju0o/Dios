import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Vitest 전용 설정 (vite.config.ts 와 분리).
 *
 * 이유: DIOS 는 Electron 앱이라 better-sqlite3 네이티브 바이너리가 Electron ABI
 * (NODE_MODULE_VERSION 130) 로 빌드되어 있고, vitest/tsc/vite 는 시스템 Node
 * (NODE_MODULE_VERSION 127) 로 실행되므로 단일 node_modules 에서 ABI 가 충돌한다.
 * 이 설정은 테스트 전용 Node-ABI 복사본(`node_modules/.b3-node`)으로 import 를
 * 리다이렉트해, 실행 중인 Electron 앱의 바이너리를 건드리지 않고 테스트가 통과하게 한다.
 * stale tsc 산출물 `tests/*.test.js` 는 중복 수집을 막기 위해 제외한다.
 */
export default defineConfig({
  resolve: {
    alias: {
      'better-sqlite3': path.resolve(__dirname, 'node_modules/.b3-node'),
    },
  },
  test: {
    // 테스트 파일들이 describe/it/expect 를 import 없이 사용하므로 globals 활성화
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'dist-electron', 'tests/**/*.test.js'],
  },
})
