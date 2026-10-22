import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(root, 'release', 'Axiloom-Portable', 'Axiloom.exe');
if (!fs.existsSync(executable)) throw new Error('پکیج portable پیدا نشد؛ ابتدا npm run build:portable را اجرا کنید.');
const child = spawn(executable, [], { cwd: path.dirname(executable), detached: true, stdio: 'ignore' });
child.unref();
