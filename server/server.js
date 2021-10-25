import express from 'express';
import lru_map from 'lru_map';
import * as Lib from '../src/lib.js';

const { LRUMap } = lru_map;

/** @type {Map<string, Promise<any>>} */
const pendingJobs = new Map();
/** @type {LRUMap<string, Array<any[]>} */
const resultsCache = new LRUMap(1000);
/** @type {LRUMap<string, Array<string[]>} */
const dependenciesCache = new LRUMap(100);

const app = express();

app.use(express.static('dist/web'));

app.get('/api/results/:packageIdentifier(*)', async (req, res) => {
  const packageIdentifier = await Lib.resolvePackageIdentifier(req.params.packageIdentifier);

  let result = resultsCache.get(packageIdentifier);
  if (!result) {
    if (pendingJobs.has(packageIdentifier)) {
      result = await pendingJobs.get(packageIdentifier);
    } else {
      const job = Lib.processPackageIfNeeded(packageIdentifier);
      pendingJobs.set(packageIdentifier, job);
      result = await job;
      pendingJobs.delete(packageIdentifier);
      resultsCache.set(packageIdentifier, result);
    }
  }

  res.send(result);
});

app.get('/api/dependencies/:packageIdentifier(*)', async (req, res) => {
  const packageIdentifier = await Lib.resolvePackageIdentifier(req.params.packageIdentifier);

  let deps = dependenciesCache.get(packageIdentifier);
  if (!deps) {
    deps = await Lib.getPackageDependencies(packageIdentifier);
    dependenciesCache.set(packageIdentifier, deps);
  }

  const statuses = {};
  for (const dep of deps) {
    const result = resultsCache.get(dep) || Lib.getPackageResultIfExists(dep);
    if (result) {
      statuses[dep] = result.success ? 'success' : 'fail';
      resultsCache.set(dep, result);
    }
  }

  res.send({
    packageIdentifier,
    dependencies: deps,
    statuses,
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send(err.message);
});

Lib.init();
app.listen(8000);
