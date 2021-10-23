import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

/**
 * @typedef PackageDetails
 * @property {string} name
 * @property {string} version
 * @property {string} gitHead
 * @property {Record<string, string>} scripts
 * @property {{type: string, url: string}} repository
 * @property {{integrity: string, shasum: string, tarball: string}} dist
 */

/**
 * @param {string} packageName
 * @return {PackageDetails}
 */
function npmView(packageName) {
  const output = execFileSync('npm', ['view', '--json', packageName], { encoding: 'utf-8' });
  return JSON.parse(output);
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
 * @param {string=} version
 */
async function processPackage(packageDetails, version) {
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

  if (!version) version = packageDetails.version;

  const errors = [];

  // Clone + checkout repo.
  const repoDir = `.tmp/repos/${packageDetails.name}`;
  fs.mkdirSync(repoDir, { recursive: true });
  if (!fs.existsSync(`${repoDir}/.git`)) {
    const url = packageDetails.repository.url.replace(/^git\+/, '');
    execFileSync('git', ['clone', url, repoDir]);
  }
  const pkgManager = fs.existsSync(`${repoDir}/yarn.lock`) ? 'yarn' : 'npm';

  const possibleCommits = [packageDetails.gitHead, `v${version}`, version];
  const commit = possibleCommits.find(commit => gitRevisionExists(repoDir, commit));
  if (commit !== packageDetails.gitHead) {
    errors.push(`package was published to npm using unreachable git commit: ${packageDetails.gitHead}. Will try tags.`);
  }
  if (commit) {
    execFileSync('git', ['checkout', commit], { cwd: repoDir });
  } else {
    errors.push(`could not find any relevant commits, tried: ${possibleCommits.join(' ')}`);
    return {
      success: false,
      errors,
    };
  }

  execFileSync('git', ['clean', '-fxd'], { cwd: repoDir });

  // Download archive.
  fs.mkdirSync('.tmp/packages', { recursive: true });
  const packageTarballPath = `.tmp/packages/${packageDetails.name}-${version}.tgz`;
  if (!fs.existsSync(packageTarballPath)) {
    execFileSync('curl', ['-o', packageTarballPath, packageDetails.dist.tarball]);
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
  const npmArchive = packageTarballPath;

  // Check shasum.
  const githubArchiveShasum = execFileSync('shasum', [githubArchive], { encoding: 'utf-8' }).split(' ')[0];

  if (githubArchiveShasum === packageDetails.dist.shasum) {
    return {
      success: true,
      errors,
    };
  }

  // Diff the metadata.
  const tarMetadataDiffRaw = execFileSync('bash', [
    '-c',
    `diff <(tar -tvf ${npmArchive} | sort) <(tar -tvf ${githubArchive} | sort) || true`,
  ], { encoding: 'utf-8' });
  const tarMetadataDiff = {
    raw: tarMetadataDiffRaw,
    files:
      [...new Set(
        tarMetadataDiffRaw.split('\n')
          .filter(line => line.startsWith('<') || line.startsWith('>'))
          .map(line => {
            const parts = line.split(/\s/);
            return parts[parts.length - 1];
          })
      )],
  };

  // Diff the contents.
  const githubArchiveUnpackedDir = `.tmp/packages-from-source/${packageDetails.name}/${version}`;
  fs.rmSync(githubArchiveUnpackedDir, { force: true, recursive: true });
  fs.mkdirSync(githubArchiveUnpackedDir, { recursive: true });
  execFileSync('tar', ['-xf', githubArchive, '-C', githubArchiveUnpackedDir]);
  fs.rmSync(githubArchive);
  const filesDiffRaw = execFileSync('bash', [
    '-c',
    `diff -urNq ${packageDir} ${githubArchiveUnpackedDir}/package || true`,
  ], { encoding: 'utf-8' });
  console.log({filesDiffRaw: `diff -urNq ${packageDir} ${githubArchiveUnpackedDir}/package || true`});
  const files = filesDiffRaw
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(' ', 2)[1].replace(`${packageDir}/`, ''));

  const diffs = [];
  for (const file of files) {
    const diff = execFileSync('bash', [
      '-c',
      `diff -uN ${packageDir}/${file} ${githubArchiveUnpackedDir}/package/${file} || true`,
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
    // tarMetadataDiff,
    diffs,
    errors,
  };
}

async function main() {
  const packageNames = [
    // 'lighthouse',
    // 'rimraf',
    // 'yargs',
    // 'which',
    // 'isexe',
    // 'rollup',
    // 'mime-types',
    // 'node-fetch',
    // 'npm-run-posix-or-windows',
    // 'package-json-versionify',
    // 'pako',
    // 'preact',
    // 'webtreemap-cdt',
    // 'typed-query-selector',
    // 'pretty-json-stringify',
    'es-main',
  ];

  for (const packageName of packageNames) {
    const packageDetails = npmView(packageName);
    console.log('processing:', packageDetails.name);
    const result = await processPackage(packageDetails);
    console.log(result);
  }
}

main();
