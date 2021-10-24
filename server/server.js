import fs from 'fs';
import express from 'express';
import { getPackageDetails, parsePackageIdentifier, processPackageIfNeeded } from '../src/lib.js';

const app = express();

app.use(express.static('.tmp/web'));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: '.tmp/web' });
});

/** @type {Map<string, Promise>} */
const pendingJobs = new Map();

app.get('/results/:packageIdentifier', async (req, res) => {
  let { packageIdentifier } = req.params;

  // If version was not provided, use the latest.
  if (!parsePackageIdentifier(packageIdentifier).version) {
    const packageDetails = getPackageDetails(packageIdentifier);
    packageIdentifier = `${packageDetails.name}@${packageDetails.version}`;
  }

  // If result is not present, calculate it.
  if (!fs.existsSync(`.tmp/results/${packageIdentifier}.json`)) {
    if (pendingJobs.has(packageIdentifier)) {
      await pendingJobs.get(packageIdentifier);
    } else {
      const job = processPackageIfNeeded(packageIdentifier);
      pendingJobs.set(packageIdentifier, job);
      await job;
      pendingJobs.delete(packageIdentifier);
    }
  }

  res.sendFile(`results/${packageIdentifier}.json`, { root: '.tmp' });
});

app.listen(8000);
