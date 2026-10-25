import { expect, it } from 'vitest';
import { detectSourceType } from './source-type';
import { SourceType } from './code-nodes';

it('detects expressions, with or without a trailing semicolon', () => {
  expect(detectSourceType('vec4(main_Chain_Chomp().r)')).toBe(
    SourceType.EXPRESSION,
  );
  expect(detectSourceType('a * 2.0;')).toBe(SourceType.EXPRESSION);
  expect(detectSourceType('// comment\nmix(a, b, 0.5)')).toBe(
    SourceType.EXPRESSION,
  );
});

it('detects shader programs by their function definitions', () => {
  expect(
    detectSourceType(`#define X 1.0
uniform float t;
void main() {
  gl_FragColor = vec4(X * t);
}`),
  ).toBe(SourceType.SHADER_PROGRAM);
});

it('detects function bodies with more than one statement', () => {
  expect(
    detectSourceType(`float x = a * 2.0;
return vec4(x);`),
  ).toBe(SourceType.FN_BODY_FRAGMENT);
});

it('returns undefined for a single non expression statement or bad code', () => {
  expect(detectSourceType('float x = 1.0;')).toBeUndefined();
  expect(detectSourceType('vec4(a.')).toBeUndefined();
  expect(detectSourceType('void main() {')).toBeUndefined();
});
