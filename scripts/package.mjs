// builds the release zip (dist/nba-spoiler-sync-<version>.zip) with just the extension's files,
// taken from the last commit so the zip matches the tagged code
// run with: npm run package
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['manifest.json', 'src', 'icons', 'README.md', 'LICENSE'];
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const uncommitted = git('status', '--porcelain', '--', ...FILES).trim();
if (uncommitted) {
  console.error(`commit these first, the zip is built from the last commit:\n${uncommitted}`);
  process.exit(1);
}

mkdirSync(join(root, 'dist'), { recursive: true });
const name = `nba-spoiler-sync-${version}`;
// unzips into its own folder, ready for Load unpacked
git('archive', '--format=zip', `--prefix=${name}/`, '-o', `dist/${name}.zip`, 'HEAD', ...FILES);
console.log(`dist/${name}.zip`);
