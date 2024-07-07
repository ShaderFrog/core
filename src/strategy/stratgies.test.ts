import { beforeEach, afterEach, expect, it } from 'vitest';

import { parser } from '@shaderfrog/glsl-parser';
import { generate } from '@shaderfrog/glsl-parser';

import { applyStrategy, StrategyType } from '.';
import * as graphModule from '../graph/graph';
import { makeExpression } from '../util/ast';

import { SourceNode } from '../graph/code-nodes';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import { mangleEntireProgram } from '../graph/graph';
import { Engine, PhysicalNodeConstructor } from 'src/engine';
import { GraphNode } from 'src/graph/graph-types';

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
    ast,
    { source } as SourceNode,
    {} as SourceNode,
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
    ast,
    { source } as SourceNode,
    {} as SourceNode,
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
    ast,
    { source } as SourceNode,
    {} as SourceNode,
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

const constructor: PhysicalNodeConstructor = () => ({
  config: {
    version: 3,
    preprocess: false,
    strategies: [],
    uniforms: [],
  },
  id: '1',
  name: '1',
  engine: true,
  type: '',
  inputs: [],
  outputs: [],
  position: { x: 0, y: 0 },
  source: '',
  stage: undefined,
});
const engine: Engine = {
  name: 'three',
  displayName: 'Three.js',
  evaluateNode: (node) => {
    if (node.type === 'number') {
      return parseFloat(node.value);
    }
    return node.value;
  },
  constructors: {
    physical: constructor,
    toon: constructor,
  },
  mergeOptions: {
    includePrecisions: true,
    includeVersion: true,
  },
  importers: {},
  preserve: new Set<string>(),
  parsers: {},
};

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
    { quiet: true },
  );

  // TODO: Experimenting with strategy tests where we mangle in the test to
  // avoid having to mangle in the strategy, in service of maybe mangling the
  // AST as part of producing context. But as the test shows -
  // mangleEntireProgram does NOT modify binding names
  //
  // You started updating binding names in the parser but realized that
  // technically a mangler can produce different results for different nodes
  // during the rename, since the parser takes in the node to mangle.
  //
  // which raised the question about why pass in the node at all to the mangler?
  // looks like it's for "doNotDescope" hack to avoid renaming a specific
  // varaible.
  //
  // But maybe that could be done here instead? And mangleEntireProgram could be
  // aware of the output varaibles to ignore? Which means we need to track the
  // output varialbe names somewhere... do we alredy?
  const node = { name: 'fake', id: '1' } as GraphNode;
  // mangleEntireProgram(engine, ast, node);
  const fillers = applyStrategy(
    { type: StrategyType.UNIFORM, config: {} },
    ast,
    {} as SourceNode,
    {} as SourceNode,
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
    makeExpression('a'),
  );
  fillers.find(([{ displayName: name }]) => name === 'output')?.[1](
    makeExpression('b'),
  );
  fillers.find(([{ displayName: name }]) => name === 'zenput')?.[1](
    makeExpression('c'),
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
    { quiet: true },
  );
  expect(
    applyStrategy(
      { type: StrategyType.TEXTURE_2D, config: {} },
      ast,
      {} as SourceNode,
      {} as SourceNode,
    ).map(([{ displayName: name }]) => name),
  ).toEqual(['noiseImage']);
});

it('finds multiple texture2D inputs for one uniform', () => {
  const ast = parser.parse(
    `
void main() {
  vec4 computed = texture2D(noiseImage, uvPow * 1.0);
  computed += texture2D(noiseImage, uvPow * 2.0);
}`,
    { quiet: true },
  );
  expect(
    applyStrategy(
      { type: StrategyType.TEXTURE_2D, config: {} },
      ast,
      {} as SourceNode,
      {} as SourceNode,
    ).map(([{ displayName: name }]) => name),
  ).toEqual(['noiseImage_0', 'noiseImage_1']);
});

it('Make sure texture2D finds preprocessed texture() call', () => {
  // I thought this was a regression, but it wasn't a real bug, but tests seems
  // benign to keep anyway
  const program = `
#define texture2DBias texture

uniform sampler2D normalMap;

void getNormal() {
    vec3 normalMap = unpackNormal(texture2DBias(normalMap, vUv0, textureBias));
}`;
  const pp = preprocess(program, {
    preserve: {
      version: () => true,
    },
  });
  const ast = parser.parse(pp, { quiet: true });
  expect(
    applyStrategy(
      { type: StrategyType.TEXTURE_2D, config: {} },
      ast,
      {} as SourceNode,
      {} as SourceNode,
    ).map(([{ displayName: name }]) => name),
  ).toEqual(['normalMapx']);
});
