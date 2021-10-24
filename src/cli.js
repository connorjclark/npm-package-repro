import fs from 'fs';
import { checkAllDepsForPackage, processPackageIfNeeded } from './lib.js';

async function main() {
  fs.mkdirSync('.tmp/packages-from-source', { recursive: true });
  fs.mkdirSync('.tmp/packages', { recursive: true });
  fs.mkdirSync('.tmp/repos', { recursive: true });
  fs.mkdirSync('.tmp/results', { recursive: true });

  const packageIdentifier = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  if (!packageIdentifier) throw new Error('missing package identifier');

  // TODO: --check-deps (only those listed in package.json)
  // TODO: --check-deps-from-source-maps (only those listed in published sm files)

  if (process.argv.includes('--check-all-deps')) {
    await checkAllDepsForPackage(packageIdentifier);
  } else {
    const result = await processPackageIfNeeded(packageIdentifier);
    console.log(result);
  }
}

main();
