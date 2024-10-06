import { expect, describe, it } from 'vitest';

import util from 'util';

import { parser } from '@shaderfrog/glsl-parser';
import { generate } from '@shaderfrog/glsl-parser';

import { Graph, ShaderStage } from './graph-types';
import { addNode, outputNode, sourceNode } from './graph-node';

import {
  shaderSectionsToProgram,
  mergeShaderSections,
  findShaderSections,
  extractSource,
  filterUniformNames,
  filterQualifiedStatements,
} from './shader-sections';
import { Program } from '@shaderfrog/glsl-parser/ast';
import { numberNode } from './data-nodes';
import { linkFromVertToFrag, makeEdge } from './edge';
import { Engine, EngineContext, PhysicalNodeConstructor } from '../engine';
import { evaluateNode } from './evaluate';
import { compileSource, nodeName } from './graph';
import { texture2DStrategy } from '../strategy';
import { isError } from './context';
import { fail } from '../test-util';
import { SourceType } from './code-nodes';
import { makeId } from 'src/util/id';

const inspect = (thing: any): void =>
  console.log(util.inspect(thing, false, null, true));

const mergeBlocks = (ast1: Program, ast2: Program): string => {
  const s1 = findShaderSections('', ast1);
  const s2 = findShaderSections('', ast2);
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
    shaderSectionsToProgram(findShaderSections('', parser.parse(code)), {
      includePrecisions: true,
      includeVersion: true,
    })
  );

const p = { x: 0, y: 0 };

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
  preserve: new Set<string>('vUv'),
  parsers: {},
};

const makeSourceNode = (
  id: string,
  source: string,
  stage: ShaderStage,
  strategies = [texture2DStrategy()]
) =>
  sourceNode(
    id,
    `Shader ${id}`,
    p,
    {
      version: 2,
      preprocess: false,
      strategies,
      uniforms: [],
    },
    source,
    stage
  );

it('compileSource() fragment produces inlined output without', async () => {
  const outV = outputNode(makeId(), 'Output v', p, 'vertex');
  const outF = outputNode(makeId(), 'Output f', p, 'fragment');
  const imageReplacemMe = makeSourceNode(
    makeId(),
    `uniform sampler2D image1;
uniform sampler2D image2;
void main() {
  vec3 col1 = texture2D(image1, posTurn - 0.4 * time).rgb + 1.0;
  vec3 col2 = texture2D(image2, negTurn - 0.4 * time).rgb + 2.0;
  gl_FragColor = vec4(col1 + col2, 1.0);
}
`,
    'fragment'
  );
  const input1 = makeSourceNode(
    makeId(),
    `float a = 1.0;
void main() {
  gl_FragColor = vec4(0.0);
}
`,
    'fragment'
  );
  const input2 = makeSourceNode(
    makeId(),
    `float a = 2.0;
void main() {
  gl_FragColor = vec4(1.0);
}
`,
    'fragment'
  );

  const graph: Graph = {
    nodes: [outV, outF, imageReplacemMe, input1, input2],
    edges: [
      makeEdge(
        makeId(),
        imageReplacemMe.id,
        outF.id,
        'out',
        'filler_frogFragOut',
        'fragment'
      ),
      makeEdge(
        makeId(),
        input1.id,
        imageReplacemMe.id,
        'out',
        'filler_image1',
        'fragment'
      ),
      makeEdge(
        makeId(),
        input2.id,
        imageReplacemMe.id,
        'out',
        'filler_image2',
        'fragment'
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, engine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  expect(result.fragmentResult).toContain(`vec4 main_Shader_${input1.id}() {`);
  expect(result.fragmentResult).toContain(`vec4 main_Shader_${input2.id}() {`);

  const imgOut = `frogOut_${imageReplacemMe.id}`;

  expect(result.fragmentResult).toContain(`vec4 ${imgOut};`);

  expect(result.fragmentResult)
    .toContain(`vec4 main_Shader_${imageReplacemMe.id}() {
  vec3 col1 = main_Shader_${input1.id}().rgb + 1.0;
  vec3 col2 = main_Shader_${input2.id}().rgb + 2.0;
  ${imgOut} = vec4(col1 + col2, 1.0);
  return ${imgOut};
}`);
});

it('compileSource() vertex produces inlined output', async () => {
  const outV = outputNode(makeId(), 'Output v', p, 'vertex');
  const outF = outputNode(makeId(), 'Output f', p, 'fragment');

  const vert = makeSourceNode(
    makeId(),
    `uniform vec4 modelViewMatrix;
attribute vec3 position;
float a = 2.0;
void main() {
  gl_Position = modelViewMatrix * vec4(position, 1.0);
}
`,
    'vertex'
  );

  const graph: Graph = {
    nodes: [outV, outF, vert],
    edges: [
      makeEdge(
        makeId(),
        vert.id,
        outV.id,
        'out',
        'filler_gl_Position',
        'vertex'
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, engine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  const iMainName = nodeName(vert);
  expect(result.vertexResult).toContain(`
void main() {
  gl_Position = ${iMainName}();
}`);
});

it('compileSource() fragment backfilling one level', async () => {
  const outV = outputNode(makeId(), 'Output v', p, 'vertex');
  const outF = outputNode(makeId(), 'Output f', p, 'fragment');
  const imageReplacemMe = makeSourceNode(
    makeId(),
    `attribute vec2 vUv;
uniform sampler2D image1;
uniform sampler2D image2;
void main() {
  vec3 col1 = texture2D(image1, vUv - 0.4 * time).rgb + 1.0;
  vec3 other1 = texture2D(image1, vUv + 1.0).rgb;
  vec3 col2 = texture2D(image2, negTurn - 0.4 * time).rgb + 2.0;
  gl_FragColor = vec4(col1 + col2, 1.0);
}
`,
    'fragment'
  );

  imageReplacemMe.backfillers = {
    filler_image1: [
      {
        argType: 'vec2',
        targetVariable: 'vUv',
      },
    ],
  };

  const input1 = makeSourceNode(
    makeId(),
    `attribute vec2 vUv;
void main() {
  gl_FragColor = vec4(vUv, 1.0, 1.0);
}
`,
    'fragment'
  );

  const graph: Graph = {
    nodes: [outV, outF, imageReplacemMe, input1],
    edges: [
      makeEdge(
        makeId(),
        imageReplacemMe.id,
        outF.id,
        'out',
        'filler_frogFragOut',
        'fragment'
      ),
      makeEdge(
        makeId(),
        input1.id,
        imageReplacemMe.id,
        'out',
        'filler_image1',
        'fragment'
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };
  const preserver = { ...engine, preserve: new Set<string>(['vUv']) };

  const result = await compileSource(graph, preserver, engineContext);
  if (isError(result)) {
    fail(result);
  }

  const inputMain = nodeName(input1);
  const imageMain = nodeName(imageReplacemMe);

  // Should preserve global variable despite backfilling
  expect(result.fragmentResult).toContain(`in vec2 vUv;`);

  // Backfilled variable should be in the main fn parameters
  // I don't think is inlined? I think this is expected by convertToMain
  expect(result.fragmentResult).toContain(`
vec4 ${inputMain}(vec2 vUv) {
  frogOut_${input1.id} = vec4(vUv, 1.0, 1.0);
  return frogOut_${input1.id};
}`);

  // The image function should pass its parameters to the child
  expect(result.fragmentResult).toContain(`
vec4 ${imageMain}() {
  vec3 col1 = ${inputMain}(vUv - 0.4 * time).rgb + 1.0;
  vec3 other1 = ${inputMain}(vUv + 1.0).rgb;
  vec3 col2 = texture(image2`);
});

it('compileSource() orphaned vertex nodes are called properly in output', async () => {
  const outV = outputNode(makeId(), 'Output v', p, 'vertex');
  const outF = outputNode(makeId(), 'Output f', p, 'fragment');

  const vert = makeSourceNode(
    makeId(),
    `uniform vec4 modelViewMatrix;
attribute vec3 position;
float a = 2.0;
void main() {
  gl_Position = modelViewMatrix * vec4(position, 1.0);
}
`,
    'vertex'
  );

  const frag = makeSourceNode(
    makeId(),
    `attribute vec2 vUv;
void main() {
  gl_FragColor = vec4(vUv, 0.0, 1.0);
}
`,
    'fragment'
  );

  const graph: Graph = {
    nodes: [outV, outF, frag, vert],
    edges: [
      makeEdge(
        makeId(),
        frag.id,
        outF.id,
        'out',
        'filler_frogFragOut',
        'fragment'
      ),
      linkFromVertToFrag(makeId(), vert.id, frag.id),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, engine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  // Make sure the orphaned vertex node is called, but not assigned to
  // a variable
  const iMainName = nodeName(vert);
  expect(result.vertexResult).toContain(`
void main() {
  ${iMainName}();
  gl_Position = vec4(1.0);
}`);
});

it('compileSource() inlining a fragment expression', async () => {
  const outV = outputNode(makeId(), 'Output v', p, 'vertex');
  const outF = outputNode(makeId(), 'Output f', p, 'fragment');
  const imageReplacemMe = makeSourceNode(
    makeId(),
    `uniform sampler2D image1;
void main() {
  vec3 col1 = texture2D(image1, posTurn - 0.4 * time).rgb + 1.0;
  gl_FragColor = vec4(col1, 1.0);
}
`,
    'fragment'
  );

  // Inine an expression source node
  const input = makeSourceNode(makeId(), `vec4(1.0)`, 'fragment');
  input.sourceType = SourceType.EXPRESSION;

  const graph: Graph = {
    nodes: [outV, outF, imageReplacemMe, input],
    edges: [
      makeEdge(
        makeId(),
        imageReplacemMe.id,
        outF.id,
        'out',
        'filler_frogFragOut',
        'fragment'
      ),
      makeEdge(
        makeId(),
        input.id,
        imageReplacemMe.id,
        'out',
        'filler_image1',
        'fragment'
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, engine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  // Verify it inlined the expression and did not memoize the source into a
  // varaible
  expect(result.fragmentResult).toContain(`vec4 ${nodeName(imageReplacemMe)}() {
  vec3 col1 = vec4(1.0).rgb + 1.0;`);
});

it('compileSource() binary properly inlines dependencies', async () => {
  const outV = outputNode(makeId(), 'Output v', p, 'vertex');
  const outF = outputNode(makeId(), 'Output f', p, 'fragment');

  const color = makeSourceNode(
    makeId(),
    `uniform sampler2D image;
void main() {
  vec3 col = texture2D(image, vec2(0.0)).rgb;
  gl_FragColor = vec4(col, 1.0);
}
`,
    'fragment'
  );

  // Inine an expression source node
  const expr = makeSourceNode(makeId(), `vec4(1.0)`, 'fragment');
  expr.sourceType = SourceType.EXPRESSION;

  const add = addNode(makeId(), p);
  const graph: Graph = {
    nodes: [color, expr, add, outV, outF],
    edges: [
      makeEdge(makeId(), color.id, add.id, 'out', 'a'),
      makeEdge(makeId(), expr.id, add.id, 'out', 'b'),
      makeEdge(
        makeId(),
        add.id,
        outF.id,
        'out',
        'filler_frogFragOut',
        'fragment'
      ),
    ],
  };

  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, engine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  expect(result.fragmentResult).toContain(`void main() {
  frogFragOut = (${nodeName(color)}()+ vec4(1.0));
}`);
});

it('compileSource() base case', async () => {
  const outV = outputNode(makeId(), 'Output v', p, 'vertex');
  const outF = outputNode(makeId(), 'Output f', p, 'fragment');
  const imageReplacemMe = makeSourceNode(
    makeId(),
    `float a = 1.0;
void main() {
  gl_FragColor = vec4(1.0);
}
`,
    'fragment'
  );

  const graph: Graph = {
    nodes: [outV, outF, imageReplacemMe],
    edges: [
      makeEdge(
        makeId(),
        imageReplacemMe.id,
        outF.id,
        'out',
        'filler_frogFragOut',
        'fragment'
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, engine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  const imgOut = `frogOut_${imageReplacemMe.id}`;
  expect(result.fragmentResult).toContain(`vec4 ${imgOut};`);
  expect(result.fragmentResult)
    .toContain(`vec4 main_Shader_${imageReplacemMe.id}() {
  ${imgOut} = vec4(1.0);
  return ${imgOut};
}`);
});

describe('evaluateNode()', () => {
  it('evaluates binary nodes', () => {
    const finalAdd = addNode(makeId(), p);
    const add2 = addNode(makeId(), p);
    const num1 = numberNode(makeId(), 'number', p, '3');
    const num2 = numberNode(makeId(), 'number', p, '5');
    const num3 = numberNode(makeId(), 'number', p, '7');
    const graph: Graph = {
      nodes: [num1, num2, num3, finalAdd, add2],
      edges: [
        makeEdge(makeId(), num1.id, finalAdd.id, 'out', 'a'),
        makeEdge(makeId(), add2.id, finalAdd.id, 'out', 'b'),
        makeEdge(makeId(), num2.id, add2.id, 'out', 'a'),
        makeEdge(makeId(), num3.id, add2.id, 'out', 'b'),
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

  const astL01 = parser.parse(`uniform Light0 { vec4 y; } x;`, { quiet: true });
  const astL02 = parser.parse(`uniform Light0 { vec4 y; } x;`, { quiet: true });
  expect(mergeBlocks(astL01, astL02)).toEqual(`uniform Light0 { vec4 y; } x;
`);

  const astL001 = parser.parse(`uniform Light0 { vec4 y; } x;`, {
    quiet: true,
  });
  const astL002 = parser.parse(`uniform Light0 x;`, { quiet: true });
  expect(mergeBlocks(astL001, astL002)).toEqual(`uniform Light0 { vec4 y; } x;
`);

  const astLo01 = parser.parse(`uniform Light0 x;`, { quiet: true });
  const astLo02 = parser.parse(`uniform Light0 { vec4 y; } x;`, {
    quiet: true,
  });
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

it('filterUniformNames', () => {
  const stmts = parser
    .parse(
      `uniform vec4 x,y;
uniform vec2 x, y[5];
uniform Light0 { vec4 y; } x;
uniform Light0 { vec4 x; } y;
`
    )
    .program.filter((s) => s.type === 'declaration_statement');
  const filtered = filterUniformNames(
    stmts.map((x) => ({ nodeId: '', source: x })),
    (name) => name !== 'x'
  );

  expect(generate(extractSource(filtered))).toEqual(`uniform vec4 y;
uniform vec2 y[5];
uniform Light0 { vec4 x; } y;
`);
});

it('filterQualifiedStatements', () => {
  const stmts = parser
    .parse(
      `in vec2 x, y;
out vec2 x;
`
    )
    .program.filter((s) => s.type === 'declaration_statement');
  const filtered = filterQualifiedStatements(
    stmts.map((x) => ({ nodeId: '', source: x })),
    (name) => name !== 'x'
  );

  expect(generate(extractSource(filtered))).toEqual(`in vec2 y;
`);
});
