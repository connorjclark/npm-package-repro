import * as Diff2Html from 'diff2html';
import { Diff2HtmlUI } from 'diff2html/lib-esm/ui/js/diff2html-ui.js';

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
 */
async function fetchPackageResults(packageIdentifier) {
  setStatus(`Loading ${packageIdentifier} package result ... This may take a couple minutes.`);
  const json = await fetch(`/api/results/${packageIdentifier}`)
    .then(async (r) => {
      if (r.ok) return r.json();

      throw new Error(await r.text());
    });
  setStatus('');
  return json;
}

/**
 * @param {string} packageIdentifier
 */
async function fetchPackageDependencies(packageIdentifier) {
  setStatus(`Loading ${packageIdentifier} package dependencies ... This may take a few seconds.`);
  const json = await fetch(`/api/dependencies/${packageIdentifier}`)
    .then(async (r) => {
      if (r.ok) return r.json();

      throw new Error(await r.text());
    });
  setStatus('');
  return json;
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
      const resultsResponse = await fetchPackageResults(packageIdentifier);
      const el = await renderPackageResult(resultsResponse);
      renderContainerEl.innerHTML = '';
      renderContainerEl.append(el);
    } else if (mode === 'deps') {
      const dependenciesResponse = await fetchPackageDependencies(packageIdentifier);
      const el = await renderPackageDependencies(dependenciesResponse.packageIdentifier, dependenciesResponse.dependencies);
      renderContainerEl.innerHTML = '';
      renderContainerEl.append(el);
    }
  } catch (err) {
    console.error(err);
    setStatus(err.toString(), 10_000);
  }
}

/**
 * @param {string} packageIdentifier
 * @param {string[]} dependencies
 */
function renderPackageDependencies(packageIdentifier, dependencies) {
  const el = document.createElement('div');
  el.classList.add('view--dependencies');

  const nameEl = document.createElement('h2');
  nameEl.textContent = `${packageIdentifier} dependencies (${dependencies.length})`;
  el.append(nameEl);

  const packageSelectorEl = document.createElement('div');
  packageSelectorEl.classList.add('package-selector');
  el.append(packageSelectorEl);

  for (const dep of dependencies) {
    const el = document.createElement('div');
    el.classList.add('package-selector__dep');
    el.textContent = dep;
    packageSelectorEl.append(el);
  }

  let diffEl;
  let selectedDep;

  /**
   * @param {string} packageIdentifier
   */
  async function renderDep(packageIdentifier) {
    selectedDep = packageIdentifier;
    if (diffEl) diffEl.remove();

    const result = await fetchPackageResults(packageIdentifier);
    if (packageIdentifier !== selectedDep) return; // TODO: a cancel-able promise would be better.

    diffEl = renderPackageResult(result);
    el.append(diffEl);
  }

  packageSelectorEl.addEventListener('click', e => {
    const targetEl = e.target;
    if (!(targetEl instanceof HTMLElement)) return;
    if (!targetEl.classList.contains('package-selector__dep')) return;

    renderDep(targetEl.textContent);
  });
  if (dependencies[0]) renderDep(dependencies[0]);

  return el;
}

/**
 * @param {any} result TODO types
 */
function renderPackageResult(result) {
  const el = document.createElement('div');
  el.classList.add('diff-container');

  const nameEl = document.createElement('h2');
  nameEl.textContent = result.packageIdentifier;
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
  const diff2htmlUi = new Diff2HtmlUI(diffEl, parsedDiffs, {
    drawFileList: true,
    fileListToggle: false,
    matching: 'lines',
    outputFormat: 'line-by-line',
  });
  diff2htmlUi.draw();
  diff2htmlUi.highlightCode();
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
