#!/usr/bin/env node
/**
 * Assemble une copie de l'extension pour Chrome / Chromium (Chrome Web Store, non répertoriée).
 * Produit un zip dans web-ext-artifacts/ sans modifier la build Firefox à la racine.
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'chrome-dist');
const artifactsDir = join(root, 'web-ext-artifacts');

const firefoxManifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const chromeManifest = JSON.parse(readFileSync(join(root, 'manifest.chrome.json'), 'utf8'));

chromeManifest.version = firefoxManifest.version;

const copyPaths = ['background', 'content', 'popup', 'icons', 'lib'];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(artifactsDir, { recursive: true });

for (const path of copyPaths) {
  cpSync(join(root, path), join(outDir, path), { recursive: true });
}

writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(chromeManifest, null, 2)}\n`);

const zipName = `pegass-extractor-chrome-${chromeManifest.version}.zip`;
const zipPath = join(artifactsDir, zipName);

execSync(`cd "${outDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });

console.log(`Chrome build: ${zipPath}`);
