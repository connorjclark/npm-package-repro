import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFilePromise = promisify(execFile);

/**
 * @typedef PackageDetails
 * @property {string} name
 * @property {string} version
 * @property {string=} gitHead
 * @property {Record<string, string>} scripts
 * @property {{type: string, url: string}} repository
 * @property {{integrity: string, shasum: string, tarball: string}} dist
 */

function init() {
  fs.mkdirSync('.tmp/packages-from-source', { recursive: true });
  fs.mkdirSync('.tmp/packages', { recursive: true });
  fs.mkdirSync('.tmp/repos', { recursive: true });
  fs.mkdirSync('.tmp/results', { recursive: true });
}

/**
 * @param {string} packageIdentifier
 * @return {Promise<PackageDetails>}
 */
async function getPackageDetails(packageIdentifier) {
  const output = await execFilePromise('npm', ['view', '--json', packageIdentifier], { encoding: 'utf-8' })
    .catch(r => /** @type {{stdout: string, stderr: string}} */(r));
  if (output.stderr.includes('is not in this registry') || !output.stdout) {
    throw new Error(`${packageIdentifier} is not in the npm registry`);
  }

  const packageDetails = JSON.parse(output.stdout);
  packageDetails.scripts = packageDetails.scripts || {};
  return packageDetails;
}

/**
 * If version is not present, use the latest.
 * @param {string} packageIdentifier
 */
async function resolvePackageIdentifier(packageIdentifier) {
  if (!parsePackageIdentifier(packageIdentifier).version) {
    const packageDetails = await getPackageDetails(packageIdentifier);
    return `${packageDetails.name}@${packageDetails.version}`;
  }

  return packageIdentifier;
}

/**
 * @param {string} file
 */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

/**
 * @param {string} dir
 * @param {string} rev
 */
async function gitRevisionExists(dir, rev) {
  try {
    await execFilePromise('git', ['rev-parse', '-q', '--verify', `${rev}^{commit}`], { cwd: dir });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * @param {string} packageIdentifier
 */
function getPackageResultIfExists(packageIdentifier) {
  if (!parsePackageIdentifier(packageIdentifier).version) {
    throw new Error(`expected version in packageIdentifier: ${packageIdentifier}`);
  }

  const resultPath = `.tmp/results/${packageIdentifier.replace('/', '_')}.json`;
  if (fs.existsSync(resultPath)) {
    return JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  }

  return null;
}

/**
 * @param {string} packageIdentifier
 */
async function processPackageIfNeeded(packageIdentifier) {
  const cachedResult = getPackageResultIfExists(packageIdentifier);
  if (cachedResult) return cachedResult;

  const packageDetails = await getPackageDetails(packageIdentifier);
  console.log(`processing: ${packageDetails.name}@${packageDetails.version}`);

  let result;
  try {
    result = await processPackage(packageDetails);
  } catch (err) {
    result = {
      packageIdentifier: `${packageDetails.name}@${packageDetails.version}`,
      name: packageDetails.name,
      version: packageDetails.version,
      success: false,
      diffs: [],
      errors: [err.toString()],
    };
  }

  const resultPath = `.tmp/results/${packageIdentifier.replace('/', '_')}.json`;
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  return result;
}

/**
 * @param {PackageDetails} packageDetails
 */
async function processPackage(packageDetails) {
  const packageIdentifier = `${packageDetails.name}@${packageDetails.version}`;

  if (!packageDetails.repository) {
    return {
      packageIdentifier,
      name: packageDetails.name,
      version: packageDetails.version,
      success: false,
      diffs: [],
      errors: [
        'Missing `repository` in package.json',
      ],
    };
  }

  if (packageDetails.repository.type !== 'git') {
    return {
      packageIdentifier,
      name: packageDetails.name,
      version: packageDetails.version,
      success: false,
      diffs: [],
      errors: [
        '`packageDetails.repository.type` must be `git`',
      ],
    };
  }

  const version = packageDetails.version;
  const errors = [];

  // Clone + checkout repo.
  const repoDir = `.tmp/repos/${packageDetails.name}`;
  fs.mkdirSync(repoDir, { recursive: true });
  if (!fs.existsSync(`${repoDir}/.git`)) {
    const url = packageDetails.repository.url.replace(/^git\+/, '');
    // TODO: wrap all commands in function that only prints output if the command fails.
    await execFilePromise('git', ['clone', url, repoDir]);
  } else {
    await execFilePromise('git', ['fetch', 'origin'], { cwd: repoDir });
  }
  const pkgManager = fs.existsSync(`${repoDir}/yarn.lock`) ? 'yarn' : 'npm';

  const possibleCommits = [];
  if (packageDetails.gitHead) possibleCommits.push(packageDetails.gitHead);
  possibleCommits.push(`v${version}`, version);

  let commit;
  for (const possibleCommit of possibleCommits) {
    if (await gitRevisionExists(repoDir, possibleCommit)) {
      commit = possibleCommit;
      break;
    }
  }

  if (commit !== packageDetails.gitHead) {
    errors.push(`package was published to npm using unreachable git commit: ${packageDetails.gitHead}. Will try tags.`);
  }
  if (commit) {
    await execFilePromise('git', ['checkout', commit], { cwd: repoDir });
  } else {
    errors.push(`could not find any relevant commits, tried: ${possibleCommits.join(' ')}`);
    return {
      packageIdentifier,
      name: packageDetails.name,
      version: packageDetails.version,
      success: false,
      diffs: [],
      errors,
    };
  }

  await execFilePromise('git', ['clean', '-fxd'], { cwd: repoDir });

  // Download archive.
  fs.mkdirSync('.tmp/packages', { recursive: true });
  const packageTarballPath = `.tmp/packages/${packageDetails.name.replace('/', '_')}-${version}.tgz`;
  if (!fs.existsSync(packageTarballPath)) {
    await execFilePromise('curl', ['-o', packageTarballPath, packageDetails.dist.tarball]);
  }

  // Unzip archive.
  const packageDir_ = `.tmp/packages/${packageDetails.name}/${version}`;
  if (!fs.existsSync(packageDir_)) {
    fs.mkdirSync(packageDir_, { recursive: true });
    await execFilePromise('tar', ['-xf', packageTarballPath, '-C', packageDir_]);
  }
  const packageDir = `${packageDir_}/package`;

  // It is only necessary to install dependencies when certain lifecycle scripts are present.
  const lifestyleScriptPresent = ['prepare', 'prepack', 'prepublishOnly', 'prepublish'].some(name => packageDetails.scripts[name]);
  if (lifestyleScriptPresent) {
    if (pkgManager === 'npm') {
      await execFilePromise('npm', ['install'], { cwd: repoDir });
      if (packageDetails.scripts.prepublishOnly) {
        try {
          await execFilePromise('npm', ['run', 'prepublishOnly'], { cwd: repoDir });
        } catch (err) {
          errors.push(err.toString());
        }
      }
    } else {
      await execFilePromise('yarn', [], { cwd: repoDir });
      if (packageDetails.scripts.prepublishOnly) {
        try {
          await execFilePromise('yarn', ['prepublishOnly'], { cwd: repoDir });
        } catch (err) {
          errors.push(err.toString());
        }
      }
    }
  }

  // Many packages don't use lifestyle scripts, so try our best to call the right build script.
  const nonStandardPrepareScript = ['build', 'build-all'].find(name => packageDetails.scripts[name]);
  if (!lifestyleScriptPresent && nonStandardPrepareScript) {
    errors.push(`lifestyle scripts were not found, so guessing that this script should be run instead: ${nonStandardPrepareScript}`);

    if (pkgManager === 'npm') {
      await execFilePromise('npm', ['install'], { cwd: repoDir });
      await execFilePromise('npm', ['run', nonStandardPrepareScript], { cwd: repoDir });
    } else {
      await execFilePromise('yarn', [], { cwd: repoDir });
      await execFilePromise('yarn', [nonStandardPrepareScript], { cwd: repoDir });
    }
  }

  // Sometimes package authors forget to update the version field in source. npm will
  // update the version before publishing, so avoid a mismatch by just setting the field manually.
  const pkg = readJson(`${repoDir}/package.json`);
  pkg.version = version;
  fs.writeFileSync(`${repoDir}/package.json`, JSON.stringify(pkg, null, 2) + '\n');

  // Create package from GitHub repo.
  await execFilePromise('npm', ['pack'], { cwd: repoDir });
  // `npm pack` only saves to a fixed location.
  const githubArchive = `${repoDir}/${packageDetails.name.replace('/', '-').replace('@', '')}-${version}.tgz`;

  // Compare with package from npm.

  // Check shasum.
  const githubArchiveShasumOutput = await execFilePromise('shasum', [githubArchive], { encoding: 'utf-8' });
  const githubArchiveShasum = githubArchiveShasumOutput.stdout.split(' ')[0];

  if (githubArchiveShasum === packageDetails.dist.shasum) {
    return {
      packageIdentifier,
      name: packageDetails.name,
      version: packageDetails.version,
      success: true,
      diffs: [],
      errors,
    };
  }

  // Diff the contents.
  const githubArchiveUnpackedDir = `.tmp/packages-from-source/${packageDetails.name}/${version}`;
  fs.rmSync(githubArchiveUnpackedDir, { force: true, recursive: true });
  fs.mkdirSync(githubArchiveUnpackedDir, { recursive: true });
  await execFilePromise('tar', ['-xf', githubArchive, '-C', githubArchiveUnpackedDir]);
  fs.rmSync(githubArchive);
  const { stdout: filesDiffRaw } = await execFilePromise('bash', [
    '-c',
    `diff -urNqw ${packageDir} ${githubArchiveUnpackedDir}/package || true`,
  ], { encoding: 'utf-8' });
  const files = filesDiffRaw
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(' ', 2)[1].replace(`${packageDir}/`, ''));

  const diffs = [];
  for (const file of files) {
    const { stdout: diff } = await execFilePromise('bash', [
      '-c',
      `diff -uNw ${githubArchiveUnpackedDir}/package/${file} ${packageDir}/${file} || true`,
    ], { encoding: 'utf-8' });
    diffs.push({ file, diff });
  }

  let success = true;
  for (const { file, diff } of diffs) {
    if (['.npmignore'].includes(file)) continue;
    if (['.md'].includes(path.extname(file))) continue;

    // File is likely of importance.

    // TODO
    // Some packages add the current date at build time, so try to ignore those.
    // const diffLines = diff
    //   .split('\n')
    //   .filter(line => line.startsWith('-\t') || line.startsWith('+\t'));
    // console.log({
    //   file, diffLines,
    // });

    // TODO: at least for package.json, normalize format before diffs.

    success = false;
    break;
  }

  return {
    packageIdentifier,
    name: packageDetails.name,
    version: packageDetails.version,
    success,
    diffs,
    errors,
  };
}

/**
 * @param {string} packageIdentifier
 */
function parsePackageIdentifier(packageIdentifier) {
  const [, name, version] = packageIdentifier.match(/(@?[^@]+)@?(.*)/) || [];
  return { name, version };
}

/**
 * @param {string} packageIdentifier
 * @return {Promise<string[]>}
 */
async function getPackageDependencies(packageIdentifier) {
  if (!parsePackageIdentifier(packageIdentifier).version) {
    throw new Error(`expected version in packageIdentifier: ${packageIdentifier}`);
  }

  // --flatten would be nice but for some silly reason the output is truncated at ~100 items.
  const output = await execFilePromise('bash', [
    '-c',
    `npx --yes npm-remote-ls ${packageIdentifier} -d false -o false`,
  ], { encoding: 'utf-8' })
    .catch(r => /** @type {{stdout: string, stderr: string}} */(r));
  if (!output.stdout.startsWith('└─')) {
    throw new Error(output.stdout);
  }
  if (output.stderr) {
    throw new Error(output.stderr);
  }

  let packageIdentifiers = output.stdout.trim().split('\n').slice(1).map(line => {
    // TODO: use parsePackageIdentifier
    const [, scope, name, version] = line.match(/─ (@?)(.+)@(.+)/) || [];
    return `${scope}${name}@${version}`;
  });
  packageIdentifiers = [...new Set(packageIdentifiers)]
    .sort((a, b) => a.localeCompare(b));

  return packageIdentifiers;
}

export {
  init,
  resolvePackageIdentifier,
  processPackageIfNeeded,
  getPackageResultIfExists,
  getPackageDependencies,
};
