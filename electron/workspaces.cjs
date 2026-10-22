const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const REGISTRY_FILE = 'axiloom-workspaces.json';

function safeName(value) {
  const name = String(value || '').trim().replace(/[\u0000-\u001f<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
  if (!name) throw new Error('Workspace name is required.');
  return name;
}

function resolveFolder(root, folder) {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, folder);
  if (absolute !== absoluteRoot && !absolute.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error('Workspace registry contains a path outside the local workspace root.');
  return absolute;
}

function saveRegistry(root, registry) {
  const filename = path.join(root, REGISTRY_FILE);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { flag: 'wx' });
  try { fs.renameSync(temporary, filename); }
  catch (error) { try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ } throw error; }
}

function loadRegistry(root) {
  const filename = path.join(root, REGISTRY_FILE);
  if (!fs.existsSync(filename)) {
    const initial = { schemaVersion: 1, activeId: 'default', workspaces: [{ id: 'default', name: 'My Workspace', folder: '.', createdAt: new Date().toISOString() }] };
    saveRegistry(root, initial);
    return initial;
  }
  let registry;
  try { registry = JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (error) { throw new Error(`Workspace registry is unreadable; preserve the local data and restore the registry from backup: ${error.message}`); }
  if (registry?.schemaVersion !== 1 || !Array.isArray(registry.workspaces)) throw new Error('Workspace registry version is unsupported.');
  const ids = new Set();
  registry.workspaces.forEach((workspace) => {
    if (!workspace || !/^[a-zA-Z0-9-]{1,80}$/.test(String(workspace.id || '')) || ids.has(workspace.id)) throw new Error('Workspace registry contains an invalid or duplicate workspace ID.');
    ids.add(workspace.id);
    workspace.name = safeName(workspace.name);
    resolveFolder(root, workspace.folder);
  });
  if (!ids.has(registry.activeId)) throw new Error('Workspace registry points to a missing active workspace.');
  return registry;
}

function activeWorkspace(root, registry = loadRegistry(root)) {
  const workspace = registry.workspaces.find((item) => item.id === registry.activeId);
  const directory = resolveFolder(root, workspace.folder);
  return { ...workspace, directory, databaseFile: path.join(directory, 'workspace.sqlite') };
}

function addWorkspace(root, registry, requestedName) {
  const name = safeName(requestedName);
  if (registry.workspaces.some((item) => item.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0)) throw new Error('A workspace with that name already exists.');
  const id = randomUUID();
  const folder = path.join('workspaces', id);
  const directory = resolveFolder(root, folder);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory, { recursive: false });
  const entry = { id, name, folder, createdAt: new Date().toISOString() };
  const next = { ...registry, workspaces: [...registry.workspaces, entry], activeId: id };
  return { registry: next, workspace: { ...entry, directory, databaseFile: path.join(directory, 'workspace.sqlite') } };
}

function activateWorkspace(root, registry, id) {
  if (!registry.workspaces.some((item) => item.id === id)) throw new Error('The selected workspace does not exist.');
  return { ...registry, activeId: id };
}

function describeRegistry(root, registry = loadRegistry(root)) {
  return registry.workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    active: workspace.id === registry.activeId,
    path: activeWorkspace(root, { ...registry, activeId: workspace.id }).directory,
    createdAt: workspace.createdAt,
  }));
}

module.exports = { REGISTRY_FILE, safeName, resolveFolder, saveRegistry, loadRegistry, activeWorkspace, addWorkspace, activateWorkspace, describeRegistry };
