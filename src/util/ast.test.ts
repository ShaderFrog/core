import { expect, it } from 'vitest';

import { parse } from '@shaderfrog/glsl-parser';
import { generate } from '@shaderfrog/glsl-parser';

import { backfillAst, findMain } from '../util/ast';

it('backfillAst', () => {
  const source = parse(`
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

it('backfillAst with void main fn', () => {
  const source = parse(`
attribute vec2 vUv;
void main(void) {
    gl_FragColor = vec4(vUv, 1.0, 1.0);
}`);

  const result = backfillAst(source, 'vec2', 'vUv', findMain(source));

  expect(generate(result)).toBe(`
attribute vec2 vUv;
void main(vec2 vUv) {
    gl_FragColor = vec4(vUv, 1.0, 1.0);
}`);
});
