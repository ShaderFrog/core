import { expect, it } from 'vitest';

import { parser } from '@shaderfrog/glsl-parser';
import { generate } from '@shaderfrog/glsl-parser';

import { findMain } from './ast';

import { addFnStmtWithIndent } from './whitespace';

it(`addFnStmtWithIndent`, () => {
  const source = `void main() {
  vec2 y;
}
`;
  const ast = parser.parse(source, { quiet: true });
  const m = findMain(ast);
  m.body.statements = addFnStmtWithIndent(m, `return x`);

  // Should line up the whitespace properly!
  expect(generate(m)).toBe(`void main() {
  vec2 y;
  return x;
}
`);
});
