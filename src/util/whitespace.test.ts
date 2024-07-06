import { expect, it } from 'vitest';

import { parser } from '@shaderfrog/glsl-parser';
import { generate } from '@shaderfrog/glsl-parser';

import { findFn, makeFnStatement } from './ast';

import { addFnStmtWithIndent } from './whitespace';

const main = findFn('main');

it(`addFnStmtWithIndent`, () => {
  const source = `void main() {
  vec2 y;
}
`;
  const ast = parser.parse(source, { quiet: true });
  const m = main(ast);
  m.body.statements = addFnStmtWithIndent(m, makeFnStatement(`return x`));

  // Should line up the whitespace properly!
  expect(generate(m)).toBe(`void main() {
  vec2 y;
  return x;
}
`);
});
