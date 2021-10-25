import * as Diff2Html from 'diff2html';

let setStatusTimeoutHandle;

/**
 * @param {string} message
 * @param {number=} timeout
 */
function setStatus(message, timeout) {
  const el = document.querySelector('.status-bar');
  if (setStatusTimeoutHandle) clearTimeout(setStatusTimeoutHandle);

  if (!message) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }

  // Wait 500ms before showing status, to prevent flicker.
  setStatusTimeoutHandle = setTimeout(() => {
    el.textContent = message;
    el.style.display = 'block';
  }, 500);

  // Clear messsage after some time.
  if (timeout !== undefined) {
    setTimeout(() => {
      if (el.textContent !== message) return;

      el.textContent = '';
      el.style.display = 'none';
    }, timeout);
  }
}

/**
 * @param {string} packageIdentifier
 * @param {string} mode
 */
async function render(packageIdentifier, mode) {
  const renderContainerEl = document.querySelector('.render-container');
  renderContainerEl.innerHTML = '';

  try {
    if (mode === 'single') {
      const el = await renderForPackage(packageIdentifier);
      renderContainerEl.innerHTML = '';
      renderContainerEl.append(el);
    } else if (mode === 'deps') {
      const el = await renderForPackageDependencies(packageIdentifier);
      renderContainerEl.innerHTML = '';
      renderContainerEl.append(el);
    }
  } catch (err) {
    setStatus(err.toString(), 10_000);
  }
}

/**
 * @param {string} packageIdentifier
 */
async function renderForPackageDependencies(packageIdentifier) {
  const el = document.createElement('div');
  el.classList.add('view--dependencies');

  setStatus('Loading package dependencies ... This may take a few seconds.');
  const dependenciesResponse = await fetch(`/api/dependencies/${packageIdentifier}`)
    .then(async (r) => {
      if (r.ok) return r.json();

      throw new Error(await r.text());
    });
  setStatus('');

  const nameEl = document.createElement('h2');
  nameEl.textContent = `${dependenciesResponse.packageIdentifier} dependencies (${dependenciesResponse.dependencies.length})`;
  el.append(nameEl);

  const packageSelectorEl = document.createElement('div');
  packageSelectorEl.classList.add('package-selector');
  el.append(packageSelectorEl);

  for (const dep of dependenciesResponse.dependencies) {
    const el = document.createElement('div');
    el.classList.add('package-selector__dep');
    el.textContent = dep;
    packageSelectorEl.append(el);
  }

  let diffEl;

  /**
   * @param {string} packageIdentifier
   */
  function renderPackage(packageIdentifier) {
    if (diffEl) diffEl.remove();
    renderForPackage(packageIdentifier).then(diffEl_ => {
      el.append(diffEl_);
      diffEl = diffEl_;
    });
  }

  packageSelectorEl.addEventListener('click', e => {
    const targetEl = e.target;
    if (!(targetEl instanceof HTMLElement)) return;

    renderPackage(targetEl.textContent);
  });

  const firstDep = dependenciesResponse.dependencies[0];
  if (firstDep) renderPackage(firstDep);

  return el;
}

/**
 * @param {string} packageIdentifier
 */
async function renderForPackage(packageIdentifier) {
  const el = document.createElement('div');
  el.classList.add('diff-container');

  setStatus('Loading package result ... This may take a couple minutes.');

  const result = await fetch(`/api/results/${packageIdentifier}`)
    .then(async (r) => {
      if (r.ok) return r.json();

      throw new Error(await r.text());
    });

  const nameEl = document.createElement('h2');
  nameEl.textContent = `${result.name}@${result.version}`;
  el.append(nameEl);

  const successEl = document.createElement('div');
  successEl.textContent = `Success: ${result.success}`;
  el.append(successEl);

  if (result.errors) {
    const errorsEl = document.createElement('pre');
    errorsEl.textContent += result.errors.join('\n---------\n');
    el.append(errorsEl);
  }

  const diffInput = result.diffs
    .map(d => d.diff)
    .join('\n');
  const parsedDiffs = Diff2Html.parse(diffInput);

  for (const parsedDiff of parsedDiffs) {
    parsedDiff.oldName = parsedDiff.oldName.replace(/^\.tmp/, '');
    parsedDiff.newName = parsedDiff.newName.replace(/^\.tmp/, '');
  }

  const diffEl = document.createElement('div');
  diffEl.innerHTML = Diff2Html.html(parsedDiffs, {
    drawFileList: true,
    matching: 'lines',
    outputFormat: 'line-by-line',
  });
  for (const movedTagEl of diffEl.querySelectorAll('.d2h-moved-tag')) {
    movedTagEl.remove();
  }
  el.append(diffEl);

  setStatus('');
  return el;
}

document.addEventListener('DOMContentLoaded', () => {
  const packageInputEl = document.querySelector('.package-input');
  document.querySelector('.go-button').addEventListener('click', () => {
    render(packageInputEl.value, document.querySelector('.mode-input input:checked').value);
  });

  render(packageInputEl.value, document.querySelector('.mode-input input:checked').value);
});
