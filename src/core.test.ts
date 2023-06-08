import util from 'util';

import { parser } from '@shaderfrog/glsl-parser';
import { visit, AstNode } from '@shaderfrog/glsl-parser/ast';
import { generate } from '@shaderfrog/glsl-parser';

import {
  applyStrategy,
  strategyRunners,
  StrategyType,
  texture2DStrategy,
} from './strategy';
import * as graphModule from './graph';
import {
  Graph,
  evaluateNode,
  ShaderStage,
  compileGraph,
  computeAllContexts,
} from './graph';
import { shaderSectionsToProgram } from './ast/shader-sections';
import { addNode, outputNode, sourceNode } from './nodes/engine-node';
import { makeExpression, returnGlPositionVec3Right } from './ast/manipulate';

import { mergeShaderSections, findShaderSections } from './ast/shader-sections';
import { Program } from '@shaderfrog/glsl-parser/ast';
import { numberNode } from './nodes/data-nodes';
import { makeEdge } from './nodes/edge';
import { SourceNode } from './nodes/code-nodes';
import { Engine, EngineContext, PhysicalNodeConstructor } from './engine';

const inspect = (thing: any): void =>
  console.log(util.inspect(thing, false, null, true));

const mergeBlocks = (ast1: Program, ast2: Program): string => {
  const s1 = findShaderSections(ast1);
  const s2 = findShaderSections(ast2);
  const merged = mergeShaderSections(s1, s2);
  return generate(
    shaderSectionsToProgram(merged, {
      includePrecisions: true,
      includeVersion: true,
    })
  );
};

const dedupe = (code: string) =>
  generate(
    shaderSectionsToProgram(findShaderSections(parser.parse(code)), {
      includePrecisions: true,
      includeVersion: true,
    })
  );

let counter = 0;
const p = { x: 0, y: 0 };
const id = () => '' + counter++;

const constructor: PhysicalNodeConstructor = () => ({
  config: {
    version: 3,
    preprocess: false,
    strategies: [],
    uniforms: [],
  },
  id: '1',
  name: '1',
  type: '',
  inputs: [],
  outputs: [],
  position: { x: 0, y: 0 },
  source: '',
  stage: undefined,
  groupId: null,
});

const engine: Engine = {
  name: 'three',
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

// it('graph compiler arbitrary helper test', () => {
//   const graph: Graph = {
//     nodes: [
//       outputNode('0', 'Output v', p, 'vertex'),
//       outputNode('1', 'Output f', p, 'fragment'),
//       makeSourceNode(
//         '2',
//         `uniform sampler2D image1;
// uniform sampler2D image2;
// void main() {
//   vec3 col = texture2D(image1, posTurn - 0.4 * time).rgb + 1.0;
//   vec3 col = texture2D(image2, negTurn - 0.4 * time).rgb + 2.0;
// }
// `,
//         'fragment'
//       ),
//       makeSourceNode(
//         '3',
//         `void main() {
//     return vec4(0.0);
// }
// `,
//         'fragment'
//       ),
//       makeSourceNode(
//         '4',
//         `void main() {
//     return vec4(1.0);
// }
// `,
//         'fragment'
//       ),
//     ],
//     edges: [
//       makeEdge(id(), '2', '1', 'out', 'filler_frogFragOut', 'fragment'),
//       makeEdge(id(), '3', '2', 'out', 'filler_image1', 'fragment'),
//       makeEdge(id(), '4', '2', 'out', 'filler_image2', 'fragment'),
//     ],
//   };
//   const engineContext: EngineContext = {
//     engine: 'three',
//     nodes: {},
//     runtime: {},
//     debuggingNonsense: {},
//   };

//   const result = compileGraph(engineContext, engine, graph);
//   const built = generate(
//     shaderSectionsToProgram(result.fragment, {
//       includePrecisions: true,
//       includeVersion: true,
//     }).program
//   );
//   expect(built).toBe('hi');
// });

describe('evaluateNode()', () => {
  it('evaluates binary nodes', () => {
    const finalAdd = addNode(id(), p);
    const add2 = addNode(id(), p);
    const num1 = numberNode(id(), 'number', p, '3');
    const num2 = numberNode(id(), 'number', p, '5');
    const num3 = numberNode(id(), 'number', p, '7');
    const graph: Graph = {
      nodes: [num1, num2, num3, finalAdd, add2],
      edges: [
        makeEdge(id(), num1.id, finalAdd.id, 'out', 'a'),
        makeEdge(id(), add2.id, finalAdd.id, 'out', 'b'),
        makeEdge(id(), num2.id, add2.id, 'out', 'a'),
        makeEdge(id(), num3.id, add2.id, 'out', 'b'),
      ],
    };
    expect(evaluateNode(engine, graph, finalAdd)).toBe(15);
  });
});

it('should merge uniforms with interface blocks', () => {
  let astX = parser.parse(`uniform vec2 x;`);
  let astY = parser.parse(`uniform vec2 y, z;
uniform vec3 a;`);
  expect(mergeBlocks(astX, astY)).toEqual(`uniform vec2 x, y, z;
uniform vec3 a;
`);

  const astL01 = parser.parse(`uniform Light0 { vec4 y; } x;`);
  const astL02 = parser.parse(`uniform Light0 { vec4 y; } x;`);
  expect(mergeBlocks(astL01, astL02)).toEqual(`uniform Light0 { vec4 y; } x;
`);

  const astL001 = parser.parse(`uniform Light0 { vec4 y; } x;`);
  const astL002 = parser.parse(`uniform Light0 x;`);
  expect(mergeBlocks(astL001, astL002)).toEqual(`uniform Light0 { vec4 y; } x;
`);

  const astLo01 = parser.parse(`uniform Light0 x;`);
  const astLo02 = parser.parse(`uniform Light0 { vec4 y; } x;`);
  expect(mergeBlocks(astLo01, astLo02)).toEqual(`uniform Light0 { vec4 y; } x;
`);

  // This may be a bug, look at how the uniforms are merged. I at least want to
  // note its current behavior in this test
  const vec2Arr1 = parser.parse(`uniform vec2 y[5];`);
  const vec2Arr2 = parser.parse(`uniform vec2 y[10];`);
  expect(mergeBlocks(vec2Arr1, vec2Arr2)).toEqual(`uniform vec2 y[10];
`);

  const block1 = parser.parse(`uniform Scene { mat4 view; };`);
  const block2 = parser.parse(`uniform Scene { mat4 view; };`);
  expect(mergeBlocks(block1, block2)).toEqual(`uniform Scene { mat4 view; };
`);

  // Verify these lines are preserved (they go through dedupeUniforms)
  expect(dedupe(`layout(std140,column_major) uniform;`)).toEqual(
    `layout(std140,column_major) uniform;`
  );
});

describe('strategies', () => {
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

  it('correctly fills with uniform strategy', () => {
    const ast = parser.parse(`
layout(std140,column_major) uniform;
uniform sampler2D image;
uniform vec4 input, output, other;
uniform vec4 zenput;
uniform Light0 { vec4 y; } x;
void main() {
  vec4 computed = texture2D(image, uvPow * 1.0);
  vec4 x = input;
  vec4 y = output;
  vec4 z = zenput;
}`);
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
    const ast = parser.parse(`
void main() {
  vec4 computed = texture2D(noiseImage, uvPow * 1.0);
}`);
    expect(
      applyStrategy(
        { type: StrategyType.TEXTURE_2D, config: {} },
        {} as SourceNode,
        ast
      ).map(([{ displayName: name }]) => name)
    ).toEqual(['noiseImage']);
  });

  it('finds multiple texture2D inputs for one uniform', () => {
    const ast = parser.parse(`
void main() {
  vec4 computed = texture2D(noiseImage, uvPow * 1.0);
  computed += texture2D(noiseImage, uvPow * 2.0);
}`);
    expect(
      applyStrategy(
        { type: StrategyType.TEXTURE_2D, config: {} },
        {} as SourceNode,
        ast
      ).map(([{ displayName: name }]) => name)
    ).toEqual(['noiseImage_0', 'noiseImage_1']);
  });
});
