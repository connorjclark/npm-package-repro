import fs from 'fs';
import express from 'express';
import { getPackageDetails, parsePackageIdentifier } from '../src/lib.js';

const app = express();

app.use(express.static('.tmp/web'));

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: '.tmp/web' });
});

app.get('/results/:packageIdentifier', async (req, res) => {
  let { packageIdentifier } = req.params;

  // If version was not provided, use the latest.
  if (!parsePackageIdentifier(packageIdentifier).version) {
    const packageDetails = getPackageDetails(packageIdentifier);
    packageIdentifier = `${packageDetails.name}@${packageDetails.version}`;
  }

  if (!fs.existsSync(`.tmp/results/${packageIdentifier}.json`)) {
    res.send(JSON.stringify({
      success: false,
      message: `unknown package: ${packageIdentifier}`,
    }));
    return;
  }

  res.sendFile(`results/${packageIdentifier}.json`, { root: '.tmp' });
});

app.listen(8000);
