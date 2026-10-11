// Exercise the installed linter and native Next.js configs without application cleanup.
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const eslint = new ESLint();
const filePath = 'src/lint-config-fixture.ts';
const [valid] = await eslint.lintText('export const value: number = 1;\n', { filePath });
assert.equal(valid.fatalErrorCount, 0);
assert.equal(valid.errorCount, 0);

const [invalid] = await eslint.lintText('export const value: any = 1;\n', { filePath });
assert.equal(invalid.fatalErrorCount, 0);
assert.ok(invalid.messages.some(message => message.ruleId === '@typescript-eslint/no-explicit-any' && message.severity === 2));

for (const ignored of ['.next/generated.ts', 'out/generated.js', 'build/generated.js', 'next-env.d.ts']) {
  assert.equal(await eslint.isPathIgnored(ignored), true, `${ignored} must remain ignored`);
}
console.log('Lint config checks passed: config loads, TypeScript parses, rules remain enforced, generated files ignored.');
