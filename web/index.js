import * as Diff2Html from 'diff2html';

/**
 * @param {string} packageIdentifier
 * @param {string} mode
 */
async function render(packageIdentifier, mode) {
  if (mode === 'single') {
    await renderForPackage(packageIdentifier);
  } else if (mode === 'deps') {
    
  }
}

/**
 * @param {string} packageIdentifier
 */
async function renderForPackage(packageIdentifier) {
  const el = document.createElement('div');
  el.classList.add('diff-container');
  document.querySelector('.render-container').addEventListener(el);

  el.textContent = 'Loading ... This may take a couple minutes.';
  el.classList.add('loading');

  const result = await fetch(`/results/${packageIdentifier}`)
    .then(r => r.json())
    .catch(err => {
      el.textContent = 'Error fetching package: ' + err.toString();
      throw err;
    })
    .finally(() => {
      el.textContent = '';
      el.classList.remove('loading');
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
}

document.addEventListener('DOMContentLoaded', () => {
  const packageInputEl = document.querySelector('.package-input');
  packageInputEl.addEventListener('change', () => {
    render(packageInputEl.value, document.querySelector('.mode-input input:checked').value);
  });

  for (const el of document.querySelectorAll('.mode-input input')) {
    el.addEventListener('change', () => {
      render(packageInputEl.value, document.querySelector('.mode-input input:checked').value);
    });
  }

  render(packageInputEl.value, document.querySelector('.mode-input input:checked').value);
});
