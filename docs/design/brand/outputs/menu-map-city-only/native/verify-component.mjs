import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const result=spawnSync(process.execPath,['node_modules/jest/bin/jest.js','--config','jest.config.js','--runInBand','--runTestsByPath','docs/design/brand/outputs/menu-map-city-only/native/CityMapMenu.test.tsx','--json'],{encoding:'utf8'});
if(result.error)throw result.error;
if(result.status!==0){process.stdout.write(result.stdout);process.stderr.write(result.stderr);process.exit(result.status??1);}
const report=JSON.parse(result.stdout);
assert.equal(report.success,true);
assert.equal(report.numPassedTests,4);
assert.equal(report.numFailedTests,0);
process.stdout.write('PASS: React Native responder and accessibility tests 4/4\n');
