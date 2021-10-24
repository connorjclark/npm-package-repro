import * as Diff2Html from 'diff2html';

/**
 * @param {string} packageName
 */
async function renderForPackage(packageName) {
  const result = await fetch(`results/${packageName}.json`).then(r => r.json());
  console.log(result);

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

  const parsedDiffs = Diff2Html.parse(result.diffs.map(d => d.diff).join('\n'), {
    drawFileList: true,
    matching: 'lines',
    outputFormat: 'side-by-side',
  });
  
  for (const parsedDiff of parsedDiffs) {
    parsedDiff.oldName = parsedDiff.oldName.replace(/^\.tmp/, '');
    parsedDiff.newName = parsedDiff.newName.replace(/^\.tmp/, '');
  }

  const diffEl = document.createElement('div');
  diffEl.innerHTML = Diff2Html.html(parsedDiffs, {
    drawFileList: true,
    matching: 'lines',
    outputFormat: 'side-by-side',
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
