import * as Lib from './lib.js';

/**
 * @param {string} packageIdentifier
 */
async function checkAllDepsForPackage(packageIdentifier) {
  const deps = Lib.getPackageDependencies(packageIdentifier);
  for (const { name, version } of deps) {
    const packageIdentifier = `${name}@${version}`;
    const result = await Lib.processPackageIfNeeded(packageIdentifier);
    if (!result.success) console.log(`problematic: ${packageIdentifier}`);
    else console.log(`ok: ${packageIdentifier}`);
  }
}

async function main() {
  Lib.init();

  let packageIdentifier = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  if (!packageIdentifier) throw new Error('missing package identifier');

  packageIdentifier = Lib.resolvePackageIdentifier(packageIdentifier);

  // TODO: --check-deps (only those listed in package.json)
  // TODO: --check-deps-from-source-maps (only those listed in published sm files)

  if (process.argv.includes('--check-all-deps')) {
    await checkAllDepsForPackage(packageIdentifier);
  } else {
    const result = await Lib.processPackageIfNeeded(packageIdentifier);
    console.log(result);
  }
}

main();
