import { expect, it } from 'vitest';

import { parser } from '@shaderfrog/glsl-parser';
import { generate } from '@shaderfrog/glsl-parser';

import { addFnStmtWithIndent } from './whitespace';
import { findMainOrThrow } from './ast';

it(`addFnStmtWithIndent`, () => {
  const source = `void main() {
  vec2 y;
}
`;
  const ast = parser.parse(source, { quiet: true });
  const m = findMainOrThrow(ast);
  m.body.statements = addFnStmtWithIndent(m, `return x`);

  // Should line up the whitespace properly!
  expect(generate(m)).toBe(`void main() {
  vec2 y;
  return x;
}
`);
});
