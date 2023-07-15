import { parser } from '@shaderfrog/glsl-parser';
import { generate } from '@shaderfrog/glsl-parser';

import { applyStrategy, StrategyType } from './strategy';
import * as graphModule from './graph';
import { makeExpression } from './ast/manipulate';

import { SourceNode } from './nodes/code-nodes';

let orig: any;
beforeEach(() => {
  orig = graphModule.mangleName;
  // Terrible hack. in the real world, strategies are applied after mangling
  // @ts-ignore
  graphModule.mangleName = (name: string) => name;
});
afterEach(() => {
  // @ts-ignore
  graphModule.mangleName = orig;
});

it('named attribute strategy`', () => {
  const source = `
in vec3 replaceThisAtrribute;
void main() {
  vec2 y = replaceThisAtrribute;
}
`;
  const ast = parser.parse(source, { quiet: true });
  const fillers = applyStrategy(
    {
      type: StrategyType.NAMED_ATTRIBUTE,
      config: {
        attributeName: 'replaceThisAtrribute',
      },
    },
    { source } as SourceNode,
    ast
  );

  expect(fillers.length).toBe(1);
  fillers[0][1]({
    type: 'literal',
    literal: `myFiller()`,
    whitespace: '',
  });
  const result = generate(ast);

  // Should replace the use of the filler, but not the declaration
  expect(result).toBe(`
in vec3 replaceThisAtrribute;
void main() {
  vec2 y = myFiller();
}
`);
});

it('inject strategy after', () => {
  const source = `
uniform float x;
// Some comment
void main() {
/* some comment */
re(x, y, z);
// Middle comment
re(x, y, z);
// Final comment
}`;
  const ast = parser.parse(source, { quiet: true });
  const fillers = applyStrategy(
    {
      type: StrategyType.INJECT,
      config: {
        find: 're(x, y, z);',
        insert: 'after',
        count: Infinity,
      },
    },
    { source } as SourceNode,
    ast
  );

  expect(fillers.length).toBe(1);
  fillers[0][1]({
    type: 'literal',
    literal: `someOtherCall(x, y, z);
someOtherCall(x, y, z);`,
    whitespace: '',
  });
  const result = generate(ast);

  // Should fill references
  expect(result).toBe(`
uniform float x;
// Some comment
void main() {
/* some comment */
re(x, y, z);
someOtherCall(x, y, z);
someOtherCall(x, y, z);
// Middle comment
re(x, y, z);
someOtherCall(x, y, z);
someOtherCall(x, y, z);
// Final comment
}`);
});

it('inject strategy before', () => {
  const source = `
uniform float x;
// Some comment
void main() {
/* some comment */
re(x, y, z);
// Middle comment
re(x, y, z);
// Final comment
}`;
  const ast = parser.parse(source, { quiet: true });
  const fillers = applyStrategy(
    {
      type: StrategyType.INJECT,
      config: {
        find: 're(x, y, z);',
        insert: 'before',
        count: Infinity,
      },
    },
    { source } as SourceNode,
    ast
  );

  expect(fillers.length).toBe(1);
  fillers[0][1]({
    type: 'literal',
    literal: `someOtherCall(x, y, z);
someOtherCall(x, y, z);`,
    whitespace: '\n',
  });
  const result = generate(ast);

  // Should fill references
  expect(result).toBe(`
uniform float x;
// Some comment
void main() {
/* some comment */
someOtherCall(x, y, z);
someOtherCall(x, y, z);
re(x, y, z);
// Middle comment
someOtherCall(x, y, z);
someOtherCall(x, y, z);
re(x, y, z);
// Final comment
}`);
});

it('correctly fills with uniform strategy', () => {
  const ast = parser.parse(
    `
layout(std140,column_major) uniform;
uniform sampler2D image;
uniform vec4 input, output, other;
uniform vec4 zenput;
uniform Light0 { vec4 y; } x;
vec3 topLevel = vec3(0.0);
void other(in vec3 param) {}
void main() {
  vec4 computed = texture2D(image, uvPow * 1.0);
  vec4 x = input;
  vec4 y = output;
  vec4 z = zenput;
}`,
    { quiet: true }
  );
  const fillers = applyStrategy(
    { type: StrategyType.UNIFORM, config: {} },
    {} as SourceNode,
    ast
  );

  // It should find uniforms with simple types, excluding sampler2D
  expect(fillers.map(([{ displayName: name }]) => name)).toEqual([
    'image',
    'input',
    'output',
    'other',
    'zenput',
  ]);

  fillers.find(([{ displayName: name }]) => name === 'input')?.[1](
    makeExpression('a')
  );
  fillers.find(([{ displayName: name }]) => name === 'output')?.[1](
    makeExpression('b')
  );
  fillers.find(([{ displayName: name }]) => name === 'zenput')?.[1](
    makeExpression('c')
  );
  const result = generate(ast);

  // Should fill references
  expect(result).toContain('vec4 x = a;');
  expect(result).toContain('vec4 y = b;');
  expect(result).toContain('vec4 z = c;');

  // Should preserve things it shouldn't touch
  expect(result).toContain('layout(std140,column_major) uniform;');
  expect(result).toContain('uniform sampler2D image;');
  expect(result).toContain('uniform Light0 { vec4 y; } x;');

  // Should remove uniforms from declarator list
  expect(result).toContain('uniform vec4 other;');
  // Should remove uniform lines
  expect(result).not.toContain('uniform vec4 zenput');
});

it('uses name without suffix for single call', () => {
  const ast = parser.parse(
    `
void main() {
  vec4 computed = texture2D(noiseImage, uvPow * 1.0);
}`,
    { quiet: true }
  );
  expect(
    applyStrategy(
      { type: StrategyType.TEXTURE_2D, config: {} },
      {} as SourceNode,
      ast
    ).map(([{ displayName: name }]) => name)
  ).toEqual(['noiseImage']);
});

it('finds multiple texture2D inputs for one uniform', () => {
  const ast = parser.parse(
    `
void main() {
  vec4 computed = texture2D(noiseImage, uvPow * 1.0);
  computed += texture2D(noiseImage, uvPow * 2.0);
}`,
    { quiet: true }
  );
  expect(
    applyStrategy(
      { type: StrategyType.TEXTURE_2D, config: {} },
      {} as SourceNode,
      ast
    ).map(([{ displayName: name }]) => name)
  ).toEqual(['noiseImage_0', 'noiseImage_1']);
});
