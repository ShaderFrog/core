import { expect, it } from 'vitest';

import { Graph, ShaderStage } from '../../graph/graph-types';
import { outputNode, sourceNode } from '../../graph/graph-node';

import { makeEdge } from '../../graph/edge';
import { EngineContext } from '../../engine';
import { compileSource } from '../../graph/graph';
import { texture2DStrategy } from 'src/strategy';
import { isError } from '../../graph/context';
import { threngine } from './threngine';
import { makeId } from 'src/util/id';

const p = { x: 0, y: 0 };

const makeSourceNode = (
  id: string,
  source: string,
  stage: ShaderStage,
  strategies = [texture2DStrategy()],
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

  console.log(result.vertexResult);

  // Threngine has parsers for vertex shaders, make sure that is set properly
  expect(result.vertexResult).toContain(`vec4 main_Shader_${vertInput.id}() {
  vec4 frogOut = modelViewMatrix * vec4(position, 1.0);
  return frogOut;
}`);

  // Check that it inlned. For fun.
  expect(result.vertexResult).toContain(
    `gl_Position = main_Shader_${vertInput.id}();`,
  );
});
