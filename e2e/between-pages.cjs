// Loaded with --require into a script that goes through the CLI, for a test to act while the script
// reads a table: at the second page of PAGED_TABLE it keeps that page's SQL in SECOND_PAGE_SQL, then
// runs BETWEEN_PAGES, the way someone using the app could.
const childProcess = require('node:child_process');
const { readFileSync, rmSync, writeFileSync } = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');

const spawnSync = childProcess.spawnSync;
let pages = 0;

childProcess.spawnSync = (command, options) => {
  const file = /-f "([^"]+)"/.exec(command)?.[1];
  const sql = file ? readFileSync(file, 'utf8') : '';
  if (sql.includes(`from ${process.env.PAGED_TABLE} as r`) && ++pages === 2) {
    writeFileSync(process.env.SECOND_PAGE_SQL, sql);
    const between = `${file}.between.sql`;
    writeFileSync(between, process.env.BETWEEN_PAGES);
    const done = spawnSync(command.replace(file, between), options);
    rmSync(between, { force: true });
    if (done.status !== 0) throw new Error(`BETWEEN_PAGES failed: ${done.stdout} ${done.stderr}`);
  }
  return spawnSync(command, options);
};
syncBuiltinESMExports();
