import { expect, it } from 'vitest';

import { Graph, ShaderStage } from '../../graph/graph-types';
import { outputNode, sourceNode } from '../../graph/graph-node';

import { makeEdge } from '../../graph/edge';
import { EngineContext } from '../../engine';
import { compileSource, nodeName, resultName } from '../../graph/graph';
import { namedAttributeStrategy, texture2DStrategy } from '../../strategy';
import { isError } from '../../graph/context';
import { threngine } from './threngine';
import { makeId } from '../../util/id';
import { fail } from '../../test-util';

const p = { x: 0, y: 0 };

let counter = 0;
const id = () => '' + counter++;

const makeSourceNode = (
  id: string,
  source: string,
  stage: ShaderStage,
  strategies = [texture2DStrategy(), namedAttributeStrategy('position')],
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
    stage,
  );

it('threngine compileSource() and manipulateAst()', async () => {
  const outV = outputNode(makeId(), 'Output v', p, 'vertex');
  const outF = outputNode(makeId(), 'Output f', p, 'fragment');

  const vertInput = makeSourceNode(
    makeId(),
    `uniform vec4 modelViewMatrix;
attribute vec3 position;
float a = 2.0;
void main() {
  gl_Position = modelViewMatrix * vec4(position, 1.0);
}
`,
    'vertex',
  );

  const graph: Graph = {
    nodes: [outV, outF, vertInput],
    edges: [
      makeEdge(
        makeId(),
        vertInput.id,
        outV.id,
        'out',
        'filler_gl_Position',
        'vertex',
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, threngine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  // Threngine has parsers for vertex shaders, make sure that is set properly
  expect(result.vertexResult).toContain(`vec4 main_Shader_${vertInput.id}() {
  vec4 frogOut = modelViewMatrix * vec4(position, 1.0);
  return frogOut;
}`);

  // Check that it inlned. For fun.
  expect(result.vertexResult).toContain(
    `gl_Position = ${resultName(vertInput)};`,
  );
});

it('threngine compileSource() linking through vertex test', async () => {
  const outV = outputNode(makeId(), 'Output v', p, 'vertex');
  const outF = outputNode(makeId(), 'Output f', p, 'fragment');

  const vert1 = makeSourceNode(
    makeId(),
    `void main() {
  gl_Position = modelViewMatrix * vec4(position, 1.0);
}
`,
    'vertex',
  );
  const vert2 = makeSourceNode(
    makeId(),
    `void main() {
  gl_Position = modelViewMatrix * vec4(position, 1.0);
}
`,
    'vertex',
  );

  const graph: Graph = {
    nodes: [outV, outF, vert1, vert2],
    edges: [
      makeEdge(
        makeId(),
        vert1.id,
        outV.id,
        'out',
        'filler_gl_Position',
        'vertex',
      ),
      makeEdge(
        makeId(),
        vert2.id,
        vert1.id,
        'out',
        'filler_position',
        'vertex',
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, threngine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  // Because vert2 links through vert1, it should be a vec3, not a vec4
  expect(result.vertexResult).toContain(`vec3 ${nodeName(vert2)}() {`);
  expect(result.vertexResult).toContain(
    `vec3 ${resultName(vert2)} = ${nodeName(vert2)}();`,
  );

  // The final vert should maintain its vec-4ness
  expect(result.vertexResult).toContain(
    `vec4 ${resultName(vert1)} = ${nodeName(vert1)}();`,
  );
});

it('compileSource() fragment produces inlined output', async () => {
  const outV = outputNode(id(), 'Output v', p, 'vertex');
  const outF = outputNode(id(), 'Output f', p, 'fragment');
  const imageReplacemMe = makeSourceNode(
    id(),
    `uniform sampler2D image1;
uniform sampler2D image2;
void main() {
  vec3 col1 = texture2D(image1, posTurn - 0.4 * time).rgb + 1.0;
  vec3 col2 = texture2D(image2, negTurn - 0.4 * time).rgb + 2.0;
  gl_FragColor = vec4(col1 + col2, 1.0);
}
`,
    'fragment',
  );
  const input1 = makeSourceNode(
    id(),
    `float a = 1.0;
void main() {
  gl_FragColor = vec4(0.0);
}
`,
    'fragment',
  );
  const input2 = makeSourceNode(
    id(),
    `float a = 2.0;
void main() {
  gl_FragColor = vec4(1.0);
}
`,
    'fragment',
  );

  const graph: Graph = {
    nodes: [outV, outF, imageReplacemMe, input1, input2],
    edges: [
      makeEdge(
        id(),
        imageReplacemMe.id,
        outF.id,
        'out',
        'filler_frogFragOut',
        'fragment',
      ),
      makeEdge(
        id(),
        input1.id,
        imageReplacemMe.id,
        'out',
        'filler_image1',
        'fragment',
      ),
      makeEdge(
        id(),
        input2.id,
        imageReplacemMe.id,
        'out',
        'filler_image2',
        'fragment',
      ),
    ],
  };
  const engineContext: EngineContext = {
    engine: 'three',
    nodes: {},
    runtime: {},
    debuggingNonsense: {},
  };

  const result = await compileSource(graph, threngine, engineContext);
  if (isError(result)) {
    fail(result);
  }

  expect(result.fragmentResult).toContain(`vec4 main_Shader_${input1.id}() {`);
  expect(result.fragmentResult).toContain(`vec4 main_Shader_${input2.id}() {`);

  const imgOut = `frogOut_${imageReplacemMe.id}`;

  expect(result.fragmentResult).toContain(`vec4 ${imgOut};`);

  const iOutName = resultName(imageReplacemMe);
  const iMainName = nodeName(imageReplacemMe);
  expect(result.fragmentResult).toContain(`
void main() {
  vec4 ${iOutName} = ${iMainName}();
  frogFragOut = ${iOutName};
}`);
});
