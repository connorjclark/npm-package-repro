import fs from 'fs';
import express from 'express';
import lru_map from 'lru_map';
import * as Lib from '../src/lib.js';

const {LRUMap} = lru_map;

/** @type {Map<string, Promise>} */
const pendingJobs = new Map();
/** @type {LRUMap<string, Array<{name: string, version: string}>} */
const dependenciesCache = new LRUMap(100);

const app = express();

app.use(express.static('.tmp/web'));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: '.tmp/web' });
});

app.get('/results/:packageIdentifier', async (req, res) => {
  const packageIdentifier = Lib.resolvePackageIdentifier(req.params.packageIdentifier);

  // If result is not present, calculate it.
  if (!fs.existsSync(`.tmp/results/${packageIdentifier}.json`)) {
    if (pendingJobs.has(packageIdentifier)) {
      await pendingJobs.get(packageIdentifier);
    } else {
      const job = Lib.processPackageIfNeeded(packageIdentifier);
      pendingJobs.set(packageIdentifier, job);
      await job;
      pendingJobs.delete(packageIdentifier);
    }
  }

  res.sendFile(`results/${packageIdentifier}.json`, { root: '.tmp' });
});

app.get('/dependencies/:packageIdentifier', async (req, res) => {
  const packageIdentifier = Lib.resolvePackageIdentifier(req.params.packageIdentifier);

  let deps = dependenciesCache.get(packageIdentifier);
  if (!deps) {
    deps = Lib.getPackageDependencies(packageIdentifier);
    dependenciesCache.set(packageIdentifier, deps);
  }

  res.send(deps);
});

Lib.init();
app.listen(8000);
