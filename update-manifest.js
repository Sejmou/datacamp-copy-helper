// this is a workaround node.js script that adds the copy-helper script (and all modules required by it) to "web_accessible_resources" of manifest.json
import { readFileSync, writeFileSync } from 'fs';
import glob from 'glob';

// https://stackoverflow.com/a/41462807/13727176
async function getDirectories(root) {
  return new Promise((resolve, reject) =>
    glob(root + '/**/*', (err, fileNames) => {
      if (err) reject();
      else {
        const jsFileNames = fileNames.filter(n => n.endsWith('.js'));
        resolve(jsFileNames);
      }
    })
  );
}

async function main() {
  const manifestPath = 'manifest.json';

  const manifest = JSON.parse(readFileSync(manifestPath));
  const copyHelperFilePaths = await getDirectories('copy-helper');

  manifest.web_accessible_resources = copyHelperFilePaths;

  // reason for weird-looking call to stringify() is pretty-printing: https://stackoverflow.com/a/5670892/13727176
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

main();
