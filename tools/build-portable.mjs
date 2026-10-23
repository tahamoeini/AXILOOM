import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const appVersion = process.env.AXILOOM_RELEASE_VERSION || packageManifest.version;
const electronVersion = packageManifest.axiloom?.portableElectronVersion;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(appVersion)) throw new Error(`نسخهٔ Axiloom معتبر نیست: ${appVersion}`);
if (!/^\d+\.\d+\.\d+$/.test(electronVersion || '')) throw new Error(`نسخهٔ Electron پرتابل در package.json معتبر نیست: ${electronVersion || 'نامشخص'}`);
const releaseRoot = path.join(root, 'release');
const output = path.join(releaseRoot, 'Axiloom-Portable');
const buildId = `${process.pid}-${Date.now()}`;
const staging = path.join(releaseRoot, `.Axiloom-Portable-stage-${buildId}`);
const archiveStaging = path.join(releaseRoot, `.Axiloom-Portable-archive-${buildId}`);
const archiveTemporary = path.join(releaseRoot, `.Axiloom-Portable-${buildId}.zip`);
const outputBackup = path.join(releaseRoot, `.Axiloom-Portable-backup-${buildId}`);
const archive = path.join(releaseRoot, 'Axiloom-Portable.zip');
const archiveBackup = path.join(releaseRoot, `.Axiloom-Portable-zip-backup-${buildId}`);
const runtimeInput = process.env.AXILOOM_ELECTRON_RUNTIME || '';
const appLocalData = process.env.LOCALAPPDATA || '';
const cachedArchive = appLocalData ? path.join(appLocalData, 'electron', 'Cache', `electron-v${electronVersion}-win32-x64.zip`) : '';
const runtimeArchive = process.env.AXILOOM_ELECTRON_ARCHIVE || cachedArchive;

function findElectronDirectory(directory) {
  if (fs.existsSync(path.join(directory, 'electron.exe'))) return directory;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = findElectronDirectory(path.join(directory, entry.name));
    if (found) return found;
  }
  return '';
}

function assertReleaseChild(target) {
  const resolved = path.resolve(target);
  const relative = path.relative(releaseRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Refusing to replace a path outside the release directory: ${resolved}`);
  return resolved;
}

function removeReleaseChild(target) {
  fs.rmSync(assertReleaseChild(target), { recursive: true, force: true });
}

function replaceWithRollback(staged, target, backup) {
  assertReleaseChild(staged);
  assertReleaseChild(target);
  assertReleaseChild(backup);
  let movedOld = false;
  try {
    if (fs.existsSync(target)) { fs.renameSync(target, backup); movedOld = true; }
    fs.renameSync(staged, target);
  } catch (error) {
    if (movedOld && !fs.existsSync(target) && fs.existsSync(backup)) fs.renameSync(backup, target);
    throw error;
  }
  if (movedOld) removeReleaseChild(backup);
}

if (process.platform !== 'win32') throw new Error('ساخت runtime پرتابل فقط روی ویندوز انجام می‌شود.');
if (!fs.existsSync(path.join(root, 'build', 'index.html'))) throw new Error('ابتدا npm run build را اجرا کنید.');

let runtimeDirectory = runtimeInput ? findElectronDirectory(runtimeInput) : '';
let extracted = '';

if (!runtimeInput) {
  if (!runtimeArchive || !fs.existsSync(runtimeArchive)) {
    throw new Error(`runtime رسمی Electron پیدا نشد. AXILOOM_ELECTRON_RUNTIME را به پوشهٔ x64 Electron یا AXILOOM_ELECTRON_ARCHIVE را به zip نسخهٔ ${electronVersion} تنظیم کنید.`);
  }
  extracted = path.join(releaseRoot, `.electron-runtime-stage-${buildId}`);
  removeReleaseChild(extracted);
  fs.mkdirSync(extracted, { recursive: true });
  const environment = { ...process.env, AXILOOM_ARCHIVE_PATH: runtimeArchive, AXILOOM_RUNTIME_PATH: extracted };
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:AXILOOM_ARCHIVE_PATH -DestinationPath $env:AXILOOM_RUNTIME_PATH -Force'], { env: environment, stdio: 'inherit' });
  runtimeDirectory = findElectronDirectory(extracted);
}

const runtimeExecutable = path.join(runtimeDirectory, 'electron.exe');
if (!runtimeDirectory || !fs.existsSync(runtimeExecutable)) throw new Error(`electron.exe در runtime انتخاب‌شده پیدا نشد: ${runtimeDirectory || runtimeInput}`);
const runtimeVersion = fs.readFileSync(path.join(runtimeDirectory, 'version'), 'utf8').trim();
if (runtimeVersion !== electronVersion) throw new Error(`نسخهٔ runtime باید Electron ${electronVersion} باشد؛ نسخهٔ انتخاب‌شده ${runtimeVersion || 'نامشخص'} است.`);
removeReleaseChild(staging);
removeReleaseChild(archiveStaging);
removeReleaseChild(archiveTemporary);
fs.mkdirSync(staging, { recursive: true });
fs.cpSync(runtimeDirectory, staging, {
  recursive: true,
  filter: (source) => path.resolve(source).toLowerCase() !== path.resolve(runtimeExecutable).toLowerCase(),
});
fs.copyFileSync(runtimeExecutable, path.join(staging, 'Axiloom.exe'));

const appDirectory = path.join(staging, 'resources', 'app');
fs.mkdirSync(appDirectory, { recursive: true });
fs.cpSync(path.join(root, 'shared'), path.join(appDirectory, '..', 'shared'), { recursive: true });
fs.cpSync(path.join(root, 'build'), path.join(appDirectory, 'build'), { recursive: true });
const electronRuntimeDirectory = path.join(root, 'electron');
const electronRuntimeFiles = fs.readdirSync(electronRuntimeDirectory)
  .filter((file) => file.endsWith('.cjs'))
  .sort();
for (const file of electronRuntimeFiles) {
  fs.copyFileSync(path.join(electronRuntimeDirectory, file), path.join(appDirectory, file));
}
fs.writeFileSync(path.join(appDirectory, 'package.json'), JSON.stringify({ name: 'axiloom', version: appVersion, main: 'main.cjs', private: true }, null, 2));
const licensesDirectory = path.join(appDirectory, 'licenses');
fs.mkdirSync(licensesDirectory, { recursive: true });
for (const [packageName, licenseName, destination] of [
  ['@fontsource/vazirmatn', 'LICENSE', 'Vazirmatn-OFL.txt'],
  ['react', 'LICENSE', 'React-MIT.txt'],
  ['react-dom', 'LICENSE', 'React-DOM-MIT.txt'],
  ['lucide-react', 'LICENSE', 'Lucide-React-ISC.txt'],
  ['chart.js', 'LICENSE.md', 'Chart.js-MIT.md'],
  ['react-chartjs-2', 'LICENSE', 'React-Chartjs-2-MIT.txt'],
]) {
  fs.copyFileSync(path.join(root, 'node_modules', packageName, licenseName), path.join(licensesDirectory, destination));
}

const metadata = {
  product: 'Axiloom',
  version: appVersion,
  platform: 'Windows x64',
  runtime: `Electron ${runtimeVersion}`,
  builtAt: new Date().toISOString(),
  workspace: './workspace/workspace.sqlite',
};
fs.writeFileSync(path.join(staging, 'Axiloom-Portable.json'), JSON.stringify(metadata, null, 2));

const existingWorkspace = path.join(output, 'workspace');
if (fs.existsSync(existingWorkspace)) fs.cpSync(existingWorkspace, path.join(staging, 'workspace'), { recursive: true, force: true });

fs.cpSync(staging, archiveStaging, { recursive: true, filter: (source) => {
  const relative = path.relative(staging, source);
  return relative !== 'workspace' && !relative.startsWith(`workspace${path.sep}`);
} });
const environment = { ...process.env, AXILOOM_PORTABLE_PATH: archiveStaging, AXILOOM_PORTABLE_ARCHIVE: archiveTemporary };
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Compress-Archive -Path (Join-Path $env:AXILOOM_PORTABLE_PATH "*") -DestinationPath $env:AXILOOM_PORTABLE_ARCHIVE -CompressionLevel Optimal'], { env: environment, stdio: 'inherit' });

replaceWithRollback(staging, output, outputBackup);
replaceWithRollback(archiveTemporary, archive, archiveBackup);
removeReleaseChild(archiveStaging);
if (extracted) removeReleaseChild(extracted);
process.stdout.write(`Portable app: ${output}\nArchive: ${archive}\n`);
