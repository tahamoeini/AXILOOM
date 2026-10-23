import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.env.AXILOOM_SMOKE_ELECTRON;
assert.ok(executable && fs.existsSync(executable), 'Set AXILOOM_SMOKE_ELECTRON to a raw Electron executable.');
const tempRoot = path.join(root, '.test-tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const directory = fs.mkdtempSync(path.join(tempRoot, 'native-smoke-'));
const resultPath = path.join(directory, 'result.json');
const environment = { ...process.env, PORTABLE_EXECUTABLE_DIR: directory, AXILOOM_SMOKE_RESULT: resultPath };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, [path.join(root, 'tools', 'native-smoke.cjs')], {
  cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostics = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-16000); });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 45000);
try {
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  assert.ok(!timedOut, 'Native smoke timed out');
  assert.ok(fs.existsSync(resultPath), `Native smoke produced no result (exit ${code})`);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  assert.equal(result.ok, true, result.error);
  assert.equal(code, 0, 'Native Electron exited unsuccessfully');
  assert.equal(result.recordPersistenceVerified, true);
  assert.equal(result.backupRestoreVerified, true);
  console.log(`Native IPC, persistence, isolation, exports, and recovery passed. Evidence: ${resultPath}`);
} catch (error) {
  console.error(diagnostics);
  throw error;
} finally { clearTimeout(timer); }
