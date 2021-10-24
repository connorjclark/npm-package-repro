import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * @typedef PackageDetails
 * @property {string} name
 * @property {string} version
 * @property {string=} gitHead
 * @property {Record<string, string>} scripts
 * @property {{type: string, url: string}} repository
 * @property {{integrity: string, shasum: string, tarball: string}} dist
 */

/**
 * @param {string} packageIdentifier
 * @return {PackageDetails}
 */
function npmView(packageIdentifier) {
  const output = execFileSync('npm', ['view', '--json', packageIdentifier], { encoding: 'utf-8' });
  const packageDetails = JSON.parse(output);
  packageDetails.scripts = packageDetails.scripts || {};
  return packageDetails;
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
function gitRevisionExists(dir, rev) {
  try {
    execFileSync('git', ['rev-parse', '-q', '--verify', `${rev}^{commit}`], { cwd: dir });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * @param {PackageDetails} packageDetails
 */
async function processPackageIfNeeded(packageDetails) {
  const resultPath = `.tmp/results/${packageDetails.name.replace('/', '_')}@${packageDetails.version}.json`;
  if (fs.existsSync(resultPath)) {
    return JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
  }

  console.log(`processing: ${packageDetails.name}@${packageDetails.version}`);

  let result;
  try {
    result = await processPackage(packageDetails);
  } catch (err) {
    result = {
      success: false,
      errors: [err.toString()],
    };
  }

  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  return result;
}

/**
 * @param {PackageDetails} packageDetails
 */
async function processPackage(packageDetails) {
  if (!packageDetails.repository) {
    return {
      success: false,
      errors: [
        'Missing `repository` in package.json',
      ],
    };
  }

  if (packageDetails.repository.type !== 'git') {
    return {
      success: false,
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
    execFileSync('git', ['clone', url, repoDir], { stdio: 'ignore' });
  } else {
    execFileSync('git', ['fetch', 'origin'], { cwd: repoDir, stdio: 'ignore' });
  }
  const pkgManager = fs.existsSync(`${repoDir}/yarn.lock`) ? 'yarn' : 'npm';

  const possibleCommits = [];
  if (packageDetails.gitHead) possibleCommits.push(packageDetails.gitHead);
  possibleCommits.push(`v${version}`, version);
  const commit = possibleCommits.find(commit => gitRevisionExists(repoDir, commit));
  if (commit !== packageDetails.gitHead) {
    errors.push(`package was published to npm using unreachable git commit: ${packageDetails.gitHead}. Will try tags.`);
  }
  if (commit) {
    execFileSync('git', ['checkout', commit], { cwd: repoDir, stdio: 'ignore' });
  } else {
    errors.push(`could not find any relevant commits, tried: ${possibleCommits.join(' ')}`);
    return {
      success: false,
      errors,
    };
  }

  execFileSync('git', ['clean', '-fxd'], { cwd: repoDir, stdio: 'ignore' });

  // Download archive.
  fs.mkdirSync('.tmp/packages', { recursive: true });
  const packageTarballPath = `.tmp/packages/${packageDetails.name}-${version}.tgz`;
  if (!fs.existsSync(packageTarballPath)) {
    execFileSync('curl', ['-o', packageTarballPath, packageDetails.dist.tarball], { stdio: 'ignore' });
  }

  // Unzip archive.
  const packageDir_ = `.tmp/packages/${packageDetails.name}/${version}`;
  if (!fs.existsSync(packageDir_)) {
    fs.mkdirSync(packageDir_, { recursive: true });
    execFileSync('tar', ['-xf', packageTarballPath, '-C', packageDir_]);
  }
  const packageDir = `${packageDir_}/package`;

  // It is only necessary to install dependencies when certain lifecycle scripts are present.
  const lifestyleScriptPresent = ['prepare', 'prepack', 'prepublishOnly', 'prepublish'].some(name => packageDetails.scripts[name]);
  if (lifestyleScriptPresent) {
    if (pkgManager === 'npm') {
      execFileSync('npm', ['install'], { cwd: repoDir });
      if (packageDetails.scripts.prepublishOnly) {
        try {
          execFileSync('npm', ['run', 'prepublishOnly'], { cwd: repoDir });
        } catch (err) {
          errors.push(err.toString());
        }
      }
    } else {
      execFileSync('yarn', [], { cwd: repoDir });
      if (packageDetails.scripts.prepublishOnly) {
        try {
          execFileSync('yarn', ['prepublishOnly'], { cwd: repoDir });
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
      execFileSync('npm', ['install'], { cwd: repoDir });
      execFileSync('npm', ['run', nonStandardPrepareScript], { cwd: repoDir });
    } else {
      execFileSync('yarn', [], { cwd: repoDir });
      execFileSync('yarn', [nonStandardPrepareScript], { cwd: repoDir });
    }
  }

  // Sometimes package authors forget to update the version field in source. npm will
  // update the version before publishing, so avoid a mismatch by just setting the field manually.
  const pkg = readJson(`${repoDir}/package.json`);
  pkg.version = version;
  fs.writeFileSync(`${repoDir}/package.json`, JSON.stringify(pkg, null, 2) + '\n');

  // Create package from GitHub repo.
  execFileSync('npm', ['pack'], { cwd: repoDir, stdio: 'ignore' });

  // Compare with package from npm.
  const githubArchive = `${repoDir}/${packageDetails.name}-${version}.tgz`;

  // Check shasum.
  const githubArchiveShasum = execFileSync('shasum', [githubArchive], { encoding: 'utf-8' }).split(' ')[0];

  if (githubArchiveShasum === packageDetails.dist.shasum) {
    return {
      success: true,
      errors,
    };
  }

  // Diff the contents.
  const githubArchiveUnpackedDir = `.tmp/packages-from-source/${packageDetails.name}/${version}`;
  fs.rmSync(githubArchiveUnpackedDir, { force: true, recursive: true });
  fs.mkdirSync(githubArchiveUnpackedDir, { recursive: true });
  execFileSync('tar', ['-xf', githubArchive, '-C', githubArchiveUnpackedDir]);
  fs.rmSync(githubArchive);
  const filesDiffRaw = execFileSync('bash', [
    '-c',
    `diff -urNqw ${packageDir} ${githubArchiveUnpackedDir}/package || true`,
  ], { encoding: 'utf-8' });
  const files = filesDiffRaw
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(' ', 2)[1].replace(`${packageDir}/`, ''));

  const diffs = [];
  for (const file of files) {
    const diff = execFileSync('bash', [
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
    success,
    diffs,
    errors,
  };
}

/**
 * @param {string} packageIdentifier
 * @return {Array<{packageName: string, version: string}>}
 */
function getPackageDependencies(packageIdentifier) {
  // --flatten would be nice but for some silly reason the output is truncated at ~100 items.
  const output = execFileSync('bash', [
    '-c',
    `npx --yes npm-remote-ls ${packageIdentifier} -d false -o false`,
  ], { encoding: 'utf-8' });
  return output.split('\n').slice(1).map(line => {
    const [, scope, name, version] = line.match(/─ (@?)(.+)@(.+)/) || [];
    return { packageName: scope + name, version };
  });
}

/**
 * @param {string} packageIdentifier
 */
async function checkAllDepsForPackage(packageIdentifier) {
  const deps = getPackageDependencies(packageIdentifier);
  for (const { packageName, version } of deps) {
    const packageDetails = npmView(`${packageName}@${version}`);
    const result = await processPackageIfNeeded(packageDetails);
    if (!result.success) console.log(`problematic: ${packageName}@${version}`);
    else console.log(`ok: ${packageName}@${version}`);
  }
}

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
    const packageDetails = npmView(packageIdentifier);
    const result = await processPackageIfNeeded(packageDetails);
    console.log(result);
  }
}

main();
