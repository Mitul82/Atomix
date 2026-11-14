import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = resolve(projectRoot, 'utils/redis');
const destDir = resolve(projectRoot, 'dist/utils/redis');

const luaScripts = ['reserveInventory.lua', 'compensateReservation.lua'];

await mkdir(destDir, { recursive: true });

await Promise.all(
    luaScripts.map((file) =>
        copyFile(resolve(sourceDir, file), resolve(destDir, file))
    )
);