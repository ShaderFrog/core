import { expect, it } from 'vitest';

import { parser } from '@shaderfrog/glsl-parser';
import { generate } from '@shaderfrog/glsl-parser';

import { applyStrategy, StrategyType } from '.';
import { makeExpression } from '../util/ast';

import { SourceNode } from '../graph/code-nodes';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import { Engine, PhysicalNodeConstructor } from '../engine';
import { NodeType } from '../graph/graph-types';
import { mangleEntireProgram } from '../graph';

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
  fillers[0][1](() => ({
    type: 'literal',
    literal: `myFiller()`,
    whitespace: '',
  }));
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
  fillers[0][1](() => ({
    type: 'literal',
    literal: `someOtherCall(x, y, z);
someOtherCall(x, y, z);`,
    whitespace: '',
  }));
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
  fillers[0][1](() => ({
    type: 'literal',
    literal: `someOtherCall(x, y, z);
someOtherCall(x, y, z);`,
    whitespace: '\n',
  }));
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
  type: NodeType.SOURCE,
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

  const fillers = applyStrategy(
    { type: StrategyType.UNIFORM, config: {} },
    ast,
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

  fillers.find(([{ displayName: name }]) => name === 'input')?.[1](() =>
    makeExpression('a'),
  );
  fillers.find(([{ displayName: name }]) => name === 'output')?.[1](() =>
    makeExpression('b'),
  );
  fillers.find(([{ displayName: name }]) => name === 'zenput')?.[1](() =>
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

it('correctly fills with uniform strategy through mangling', () => {
  const ast = parser.parse(
    `
uniform sampler2D image;
uniform vec4 input, output;
void main() {
  vec4 computed = texture2D(image, uvPow * 1.0);
  vec4 x = input;
  vec4 y = output;
}`,
    { quiet: true },
  );

  const node = { id: '1', name: 'fake' } as SourceNode;

  const fillers = applyStrategy(
    { type: StrategyType.UNIFORM, config: {} },
    ast,
    node,
  );

  mangleEntireProgram(engine, ast, node);

  // It should find uniforms with simple types, excluding sampler2D
  expect(fillers.map(([{ displayName: name }]) => name)).toEqual([
    'image',
    'input',
    'output',
  ]);

  const a = fillers.find(([{ displayName: name }]) => name === 'input')?.[1];
  fillers.find(([{ displayName: name }]) => name === 'input')?.[1](() =>
    makeExpression('a'),
  );
  fillers.find(([{ displayName: name }]) => name === 'output')?.[1](() =>
    makeExpression('b'),
  );
  const result = generate(ast);

  // Should fill references
  expect(result).toContain('vec4 x = a;');
  expect(result).toContain('vec4 y = b;');

  // Should preserve things it shouldn't touch
  expect(result).toContain(`uniform sampler2D image_${node.id};`);
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

it('finds one texture2D input for one texture2D() call', () => {
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
  ).toEqual(['noiseImage']);
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
  ).toEqual(['normalMap']);
});
