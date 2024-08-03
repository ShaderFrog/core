import { expect, it } from 'vitest';

import { parser } from '@shaderfrog/glsl-parser';
import { generate } from '@shaderfrog/glsl-parser';

import { backfillAst, findMain } from '../util/ast';

it('backfillAst', () => {
  const source = parser.parse(`
attribute vec2 vUv, xx;
void main() {
    gl_FragColor = vec4(vUv, xx);
}`);

  const result = backfillAst(source, 'vec2', 'vUv', findMain(source));

  expect(generate(result)).toBe(`
attribute vec2 vUv, xx;
void main(vec2 vUv) {
    gl_FragColor = vec4(vUv, xx);
}`);
});
