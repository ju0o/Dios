/**
 * Vitest runs on system Node, while packaging rebuilds better-sqlite3 for Electron.
 * Keep a Node-ABI copy at node_modules/.b3-node so tests keep working after a rebuild.
 * If the current install already fails under Node, leave it alone.
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'node_modules', 'better-sqlite3')
const dest = path.join(root, 'node_modules', '.b3-node')

/** True when this Node can open that copy's native binary. An Electron rebuild must not be reused for tests. */
function loads(pkgDir) {
  const binary = path.join(pkgDir, 'build', 'Release', 'better_sqlite3.node')
  if (!fs.existsSync(binary)) return false
  try {
    createRequire(import.meta.url)(binary)
    return true
  } catch {
    return false
  }
}

if (loads(dest)) process.exit(0)
if (!fs.existsSync(src)) process.exit(0)

// Prefer a binary this Node already runs. Otherwise compile a test-only copy and leave the Electron binary alone.
if (loads(src)) {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true, filter: (from) => !from.includes(`${path.sep}obj${path.sep}`) })
} else if (!fs.existsSync(path.join(dest, 'binding.gyp'))) {
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(src, dest, { recursive: true, filter: (from) => !from.includes(`${path.sep}obj${path.sep}`) })
}

if (!loads(dest)) {
  const built = spawnSync('npx', ['--yes', 'node-gyp', 'rebuild'], { cwd: dest, stdio: 'inherit', shell: true })
  if (built.status !== 0 || !loads(dest)) {
    console.error('better-sqlite3 could not be built for this Node, so database tests may fail.')
    process.exit(0)
  }
}
console.log('node sqlite copy ready')
