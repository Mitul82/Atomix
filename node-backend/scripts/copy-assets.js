import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(projectRoot, 'utils/redis/reserveInventory.lua');
const destination = resolve(projectRoot, 'dist/utils/redis/reserveInventory.lua');

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
