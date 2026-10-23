import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = process.env.AXILOOM_RELEASE_VERSION || manifest.version;
const electronVersion = manifest.axiloom?.portableElectronVersion;
const arch = process.env.AXILOOM_ELECTRON_ARCH || process.arch;
const archiveInput = process.env.AXILOOM_ELECTRON_ARCHIVE || '';
if (process.platform !== 'darwin') throw new Error('ساخت برنامهٔ macOS باید روی macOS اجرا شود.');
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`نسخهٔ Axiloom معتبر نیست: ${version}`);
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(electronVersion || '')) throw new Error(`نسخهٔ Electron معتبر نیست: ${electronVersion || 'نامشخص'}`);
if (!['arm64', 'x64'].includes(arch)) throw new Error(`معماری macOS باید arm64 یا x64 باشد: ${arch}`);
if (!fs.existsSync(path.join(root, 'build', 'index.html'))) throw new Error('ابتدا npm run build را اجرا کنید.');
if (!archiveInput || !fs.existsSync(archiveInput)) throw new Error('AXILOOM_ELECTRON_ARCHIVE به آرشیو رسمی Electron اشاره نمی‌کند.');

const releaseRoot = path.join(root, 'release');
fs.mkdirSync(releaseRoot, { recursive: true });
const token = `${process.pid}-${Date.now()}`;
const extractRoot = path.join(releaseRoot, `.electron-mac-${token}`);
const stageRoot = path.join(releaseRoot, `.Axiloom-mac-${token}`);
const appPath = path.join(stageRoot, 'Axiloom.app');
const archivePath = path.join(releaseRoot, `Axiloom-Portable-v${version}-macos-${arch}.zip`);
const appVersion = version.split('-')[0];
const electronAppName = `Electron.app`;

function findApp(directory) {
  if (path.basename(directory) === electronAppName && fs.existsSync(path.join(directory, 'Contents', 'Info.plist'))) return directory;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = findApp(path.join(directory, entry.name));
    if (found) return found;
  }
  return '';
}
function setPlist(plistPath, key, value) {
  const safeValue = String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} "${safeValue}"`, plistPath], { stdio: 'ignore' }); }
  catch { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string "${safeValue}"`, plistPath], { stdio: 'ignore' }); }
}
function rebrandHelperApps(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.name.endsWith('.app')) {
      const plistPath = path.join(entryPath, 'Contents', 'Info.plist');
      if (fs.existsSync(plistPath)) {
        const helperName = entry.name.slice(0, -'.app'.length);
        const helperSlug = helperName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'helper';
        setPlist(plistPath, 'CFBundleName', `Axiloom ${helperName.replace(/^Electron\s*/, '')}`.trim());
        setPlist(plistPath, 'CFBundleDisplayName', `Axiloom ${helperName.replace(/^Electron\s*/, '')}`.trim());
        setPlist(plistPath, 'CFBundleIdentifier', `com.axiloom.desktop.helper.${helperSlug}`);
        setPlist(plistPath, 'CFBundleShortVersionString', appVersion);
        setPlist(plistPath, 'CFBundleVersion', appVersion);
      }
    }
    rebrandHelperApps(entryPath);
  }
}
function copyLicense(packageName, licenseName, destination, appDirectory) {
  const source = path.join(root, 'node_modules', packageName, licenseName);
  fs.copyFileSync(source, path.join(appDirectory, 'licenses', destination));
}

try {
  fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.rmSync(stageRoot, { recursive: true, force: true });
  fs.rmSync(archivePath, { force: true });
  fs.mkdirSync(extractRoot, { recursive: true });
  execFileSync('/usr/bin/ditto', ['-x', '-k', archiveInput, extractRoot], { stdio: 'inherit' });
  const runtimeApp = findApp(extractRoot);
  if (!runtimeApp) throw new Error('Electron.app در آرشیو رسمی runtime پیدا نشد.');
  const versionFile = path.join(path.dirname(runtimeApp), 'version');
  const runtimeVersion = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : '';
  if (runtimeVersion && runtimeVersion !== electronVersion) throw new Error(`نسخهٔ runtime باید ${electronVersion} باشد؛ ${runtimeVersion} دریافت شد.`);
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.cpSync(runtimeApp, appPath, { recursive: true, preserveTimestamps: true });
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
  setPlist(infoPlist, 'CFBundleName', 'Axiloom');
  setPlist(infoPlist, 'CFBundleDisplayName', 'Axiloom');
  setPlist(infoPlist, 'CFBundleIdentifier', 'com.axiloom.desktop');
  setPlist(infoPlist, 'CFBundleShortVersionString', appVersion);
  setPlist(infoPlist, 'CFBundleVersion', appVersion);
  rebrandHelperApps(path.join(appPath, 'Contents', 'Frameworks'));
  const appDirectory = path.join(appPath, 'Contents', 'Resources', 'app');
  fs.mkdirSync(appDirectory, { recursive: true });
  fs.cpSync(path.join(root, 'build'), path.join(appDirectory, 'build'), { recursive: true });
  for (const file of fs.readdirSync(path.join(root, 'electron')).filter((name) => name.endsWith('.cjs')).sort()) {
    fs.copyFileSync(path.join(root, 'electron', file), path.join(appDirectory, file));
  }
  fs.cpSync(path.join(root, 'shared'), path.join(appDirectory, '..', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(appDirectory, 'package.json'), JSON.stringify({ name: 'axiloom', version, main: 'main.cjs', private: true }, null, 2));
  execFileSync(process.execPath, [path.join(root, 'tools', 'verify-package.mjs'), appDirectory], { stdio: 'inherit' });
  fs.mkdirSync(path.join(appDirectory, 'licenses'), { recursive: true });
  for (const [packageName, licenseName, destination] of [
    ['@fontsource/vazirmatn', 'LICENSE', 'Vazirmatn-OFL.txt'], ['react', 'LICENSE', 'React-MIT.txt'],
    ['react-dom', 'LICENSE', 'React-DOM-MIT.txt'], ['lucide-react', 'LICENSE', 'Lucide-React-ISC.txt'],
    ['chart.js', 'LICENSE.md', 'Chart.js-MIT.md'], ['react-chartjs-2', 'LICENSE', 'React-Chartjs-2-MIT.txt'],
  ]) copyLicense(packageName, licenseName, destination, appDirectory);
  fs.writeFileSync(path.join(appPath, 'Contents', 'Resources', 'Axiloom-Portable.json'), JSON.stringify({
    product: 'Axiloom', version, platform: `macOS ${arch}`, runtime: `Electron ${electronVersion}`,
    builtAt: new Date().toISOString(), workspace: '~/Library/Application Support/Axiloom/workspace', signed: false,
  }, null, 2));
  const executable = path.join(appPath, 'Contents', 'MacOS', 'Electron');
  if (!fs.existsSync(executable)) throw new Error('فایل اجرایی Electron در بسته پیدا نشد.');
  const runtimeArchitectures = execFileSync('/usr/bin/lipo', ['-archs', executable], { encoding: 'utf8' }).trim().split(/\s+/);
  const normalizedRuntimeArchitectures = runtimeArchitectures.map((runtimeArch) => runtimeArch === 'x86_64' ? 'x64' : runtimeArch);
  if (!normalizedRuntimeArchitectures.includes(arch)) throw new Error(`معماری فایل اجرایی ${runtimeArchitectures.join(', ')} است، نه ${arch}.`);
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archivePath], { stdio: 'inherit' });
  const required = [executable, path.join(appDirectory, 'main.cjs'), path.join(appDirectory, 'data-access-worker.cjs'), path.join(appDirectory, 'build', 'index.html')];
  for (const file of required) if (!fs.existsSync(file)) throw new Error(`بستهٔ macOS ناقص است: ${path.relative(stageRoot, file)}`);
  if (!fs.statSync(archivePath).size) throw new Error('ZIP نهایی خالی است.');
  process.stdout.write(`macOS ${arch} app: ${appPath}\nArchive: ${archivePath}\n`);
} finally {
  fs.rmSync(extractRoot, { recursive: true, force: true });
  fs.rmSync(stageRoot, { recursive: true, force: true });
}
