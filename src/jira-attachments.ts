import limits from '../shared/resource-limits.json';

export function validateAttachmentSelection(files: File[]) {
  const bounds = limits.attachments;
  if (!files.length || files.length > bounds.maxFiles) throw new Error(`Select between 1 and ${bounds.maxFiles} attachment files.`);
  let total = 0;
  for (const file of files) {
    if (file.name.length > bounds.maxFileNameCharacters) throw new Error(`Attachment names must be at most ${bounds.maxFileNameCharacters} characters.`);
    if (file.size > bounds.maxFileBytes) throw new Error(`Each attachment must be at most ${bounds.maxFileBytes / 1024 / 1024} MB.`);
    total += file.size;
    if (total > bounds.maxTotalBytes) throw new Error(`Attachments together must be at most ${bounds.maxTotalBytes / 1024 / 1024} MB.`);
  }
  return total;
}

export async function serializeAttachmentSelection(files: File[]) {
  validateAttachmentSelection(files);
  return Promise.all(files.map(async (file) => ({
    name: file.name,
    type: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  })));
}
