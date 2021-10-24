import * as Diff2Html from 'diff2html';

/**
 * @param {string} packageIdentifier
 */
async function renderForPackage(packageIdentifier) {
  const result = await fetch(`results/${packageIdentifier}.json`).then(r => r.json());

  const el = document.querySelector('.diff-container');
  el.innerHTML = '';

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
}

document.addEventListener('DOMContentLoaded', () => {
  const packageInputEl = document.querySelector('.package-input');
  packageInputEl.addEventListener('change', () => {
    renderForPackage(packageInputEl.value);
  });

  renderForPackage(packageInputEl.value);
});
