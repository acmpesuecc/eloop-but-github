import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from 'dotenv';
import { renderToStaticMarkup } from 'react-dom/server';
import Dropzone from 'react-dropzone';

const directory = await mkdtemp('/tmp/opencode/dependency-migration-');
try {
  const envPath = path.join(directory, '.env');
  await writeFile(envPath, 'EXISTING=file\nADDED="quoted value"\n');
  const runtimeEnv = { EXISTING: 'deployment' };
  const runtime = config({ path: envPath, processEnv: runtimeEnv, override: false, quiet: true });
  assert.equal(runtime.error, undefined);
  assert.deepEqual(runtimeEnv, { EXISTING: 'deployment', ADDED: 'quoted value' });

  const initializerEnv = { EXISTING: 'deployment' };
  const initializer = config({ path: envPath, processEnv: initializerEnv, override: true, quiet: true });
  assert.equal(initializer.error, undefined);
  assert.deepEqual(initializerEnv, { EXISTING: 'file', ADDED: 'quoted value' });

  const markup = renderToStaticMarkup(
    <Dropzone>
      {({ getRootProps, getInputProps }) => (
        <div {...getRootProps()}><input {...getInputProps()} />Upload file</div>
      )}
    </Dropzone>
  );
  assert.match(markup, /type="file"/);
  assert.match(markup, /Upload file/);
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Dependency migration checks passed: dotenv precedence and parsing, Dropzone package-root import and React rendering.');
