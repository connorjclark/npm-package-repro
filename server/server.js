import express from 'express';
import lru_map from 'lru_map';
import * as Lib from '../src/lib.js';

const { LRUMap } = lru_map;

/** @type {Map<string, Promise<any>>} */
const pendingJobs = new Map();
/** @type {LRUMap<string, Array<{name: string, version: string}>} */
const dependenciesCache = new LRUMap(100);

const app = express();

app.use(express.static('.tmp/web'));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: '.tmp/web' });
});

app.get('/api/results/:packageIdentifier(*)', async (req, res) => {
  const packageIdentifier = await Lib.resolvePackageIdentifier(req.params.packageIdentifier);

  let result;
  if (pendingJobs.has(packageIdentifier)) {
    result = await pendingJobs.get(packageIdentifier);
  } else {
    const job = Lib.processPackageIfNeeded(packageIdentifier);
    pendingJobs.set(packageIdentifier, job);
    result = await job;
    pendingJobs.delete(packageIdentifier);
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

  res.send({
    packageIdentifier,
    dependencies: deps,
  });
});

// TODO 5.0.0-alpha.8
app.use(async (err, req, res) => {
  console.error(err.stack);
  res.status(500).send(err.toString());
});

Lib.init();
app.listen(8000);
