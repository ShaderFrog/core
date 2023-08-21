import * as pc from 'playcanvas';
import { Engine, EngineNodeType, EngineContext } from '../../engine';
import {
  nodeName,
  doesLinkThruShader,
  prepopulatePropertyInputs,
  mangleMainFn,
} from '../../graph';
import { ShaderStage, Graph, NodeType } from '../../graph-types';
import importers from './importers';

import {
  returnGlPositionHardCoded,
  returnGlPosition,
  returnGlPositionVec3Right,
} from '../../ast/manipulate';

import { Program } from '@shaderfrog/glsl-parser/ast';
import {
  CodeNode,
  NodeProperty,
  property,
  SourceNode,
} from '../../nodes/code-nodes';

import {
  namedAttributeStrategy,
  texture2DStrategy,
  uniformStrategy,
} from '../../strategy';
import { NodeInput, NodePosition } from '../../nodes/core-node';
import { DataNode, UniformDataType } from '../../nodes/data-nodes';
import { NodeParser } from '../../parsers';

const log = (...args: any[]) =>
  console.log.call(console, '\x1b[33m(playengine)\x1b[0m', ...args);

export const physicalDefaultProperties = {
  // Required for objects with opacity
  blendType: pc.BLEND_NORMAL,
  // Required if you set blendtype apparently lol, otherwise object is black
  opacity: 1,
};

const applyPlayMaterialProperties = (
  shaderMaterial: pc.Material,
  app: pc.Application,
  graph: Graph,
  node: SourceNode,
  sibling?: SourceNode
): Record<string, any> => {
  // Find inputs to this node that are dependent on a property of the material
  const propertyInputs = node.inputs
    .filter((i) => i.property)
    .reduce<Record<string, NodeInput>>(
      (acc, input) => ({ ...acc, [input.id]: input }),
      {}
    );

  // Then look for any edges into those inputs and set the material property
  const props = graph.edges
    .filter((edge) => edge.to === node.id || edge.to === sibling?.id)
    .reduce<Record<string, any>>((acc, edge) => {
      // Check if we've plugged into an input for a property
      const propertyInput = propertyInputs[edge.input];
      if (propertyInput) {
        // Find the property itself
        const property = (node.config.properties || []).find(
          (p) => p.property === propertyInput.property
        ) as NodeProperty;

        /**
         * Where you see "0.5" below, these values are intentionally set to. And
         * this method intentionally returns the properties set (for debugging)
         * as well as mutates the material in place.
         *
         * For the mutation, you apparently need to explicitily call .set() on
         * some properties, like diffuse:
         *    material.diffuse = new pc.Color(0.5, 0.5, 0.5)
         * has no effect. You have to do
         *     material.diffuse.set(0.5, 0.5, 0.5)
         * and note the API isn't great, you can't do
         *     material.diffuse.set(new pc.Color(...))
         * So we have to specifically mutate the object. This code will probably
         * error on some properties because I don't know if all "rgb" properties
         * have to be set in this painful way.
         *
         * For the use of "0.5", apparently PlayCanvas optimizes uniform
         * generation where if you set diffuse to white (1,1,1) then it doesn't
         * add the diffuse uniform, because that's the default state.
         */
        if (property.type === 'texture') {
          acc[property.property] = new pc.Texture(app.graphicsDevice);
          // @ts-ignore
          shaderMaterial[property.property] = acc[property.property];
        } else if (property.type === 'number') {
          acc[property.property] = 0.99;
          // @ts-ignore
          shaderMaterial[property.property] = acc[property.property];
        } else if (property.type === 'rgb') {
          acc[property.property] = new pc.Color(0.5, 0.5, 0.5);
          // @ts-ignore
          shaderMaterial[property.property].set(0.5, 0.5, 0.5);
        } else if (property.type === 'rgba') {
          acc[property.property] = new pc.Color(0.5, 0.5, 0.5, 0.5);
          // @ts-ignore
          shaderMaterial[property.property].set(0.5, 0.5, 0.5, 0.5);
        }
      }
      return acc;
    }, {});
  return props;
};

export const physicalNode = (
  id: string,
  name: string,
  groupId: string | null | undefined,
  position: NodePosition,
  uniforms: UniformDataType[],
  stage: ShaderStage | undefined,
  nextStageNodeId?: string
): CodeNode =>
  prepopulatePropertyInputs({
    id,
    name,
    groupId,
    position,
    type: EngineNodeType.physical,
    config: {
      uniforms,
      version: 3,
      mangle: false,
      preprocess: true,
      properties: [
        property('Color', 'diffuse', 'rgb'),
        property(
          'Diffuse Map',
          'diffuseMap',
          'texture',
          'filler_texture_diffuseMap'
        ),
        property(
          'Normal Map',
          'normalMap',
          'texture',
          'filler_texture_normalMap'
        ),
        property('Bumpiness', 'bumpiness', 'number'),
        property('Specular', 'specular', 'rgb'),
        property('Opacity', 'opacity', 'number'),
        property('Opacity Map', 'opacityMap', 'texture'),
        property('Metalness', 'metalness', 'number'),
        // property('Bump Map', 'bumpTexture', 'texture', 'filler_bumpSampler'),
        // property('Metalness', 'metallic', 'number'),
        // property('Roughness', 'roughness', 'number'),
        // property('Env Map', 'environmentTexture', 'samplerCube'),
        // property('Reflection Texture', 'reflectionTexture', 'samplerCube'),
        // property('Refraction Texture', 'refractionTexture', 'samplerCube'),
        // property('Index Of Refraction', 'indexOfRefraction', 'number'),
        // property('Alpha', 'alpha', 'number'),
        // property('Direct Intensity', 'directIntensity', 'number'),
        // property('Environment Intensity', 'environmentIntensity', 'number'),
        // property('Camera Exposure', 'cameraExposure', 'number'),
        // property('Camera Contrast', 'cameraContrast', 'number'),
        // property('Micro Surface', 'microSurface', 'number'),
        // property('Reflectivity Color', 'reflectivityColor', 'rgb'),
      ],
      hardCodedProperties: physicalDefaultProperties,
      strategies: [
        uniformStrategy(),
        stage === 'fragment'
          ? texture2DStrategy()
          : namedAttributeStrategy('position'),
      ],
    },
    inputs: [],
    outputs: [
      {
        name: 'vector4',
        category: 'data',
        id: '1',
      },
    ],
    source: '',
    stage,
    nextStageNodeId,
  });

export type RuntimeContext = {
  scene: pc.Scene;
  camera: pc.Camera;
  pc: any;
  sceneData: any;
  cache: {
    data: {
      [key: string]: any;
    };
    nodes: {
      [id: string]: {
        // fragmentRef: any;
        // vertexRef: any;
        fragment: string;
        vertex: string;
      };
    };
  };
};

export const toonNode = (
  id: string,
  name: string,
  groupId: string | null | undefined,
  position: NodePosition,
  uniforms: UniformDataType[],
  stage: ShaderStage | undefined,
  nextStageNodeId?: string
): CodeNode =>
  prepopulatePropertyInputs({
    id,
    name,
    groupId,
    position,
    type: EngineNodeType.toon,
    config: {
      uniforms,
      version: 3,
      preprocess: true,
      mangle: false,
      properties: [
        property('Color', 'color', 'rgb', 'uniform_diffuse'),
        property('Texture', 'map', 'texture', 'filler_map'),
        property(
          'Gradient Map',
          'gradientMap',
          'texture',
          'filler_gradientMap'
        ),
        property('Normal Map', 'normalMap', 'texture', 'filler_normalMap'),
        property('Normal Scale', 'normalScale', 'vector2'),
        property('Displacement Map', 'displacementMap', 'texture'),
        property('Env Map', 'envMap', 'samplerCube'),
      ],
      strategies: [
        uniformStrategy(),
        stage === 'fragment'
          ? texture2DStrategy()
          : namedAttributeStrategy('position'),
      ],
    },
    inputs: [],
    outputs: [
      {
        name: 'vector4',
        category: 'data',
        id: '1',
      },
    ],
    source: '',
    stage,
    nextStageNodeId,
  });

export let mIdx = 0;
let id = () => mIdx++;

const nodeCacheKey = (graph: Graph, node: SourceNode) => {
  return (
    '[ID:' +
    node.id +
    'Edges:' +
    graph.edges
      .filter((edge) => edge.to === node.id)
      .map((edge) => `(${edge.to}->${edge.input})`)
      .sort()
      .join(',') +
    ']'
    // Currently excluding node inputs because these are calculated *after*
    // the onbeforecompile, so the next compile, they'll all change!
    // node.inputs.map((i) => `${i.id}${i.bakeable}`)
  );
};

const programCacheKey = (
  engineContext: EngineContext,
  graph: Graph,
  node: SourceNode,
  sibling: SourceNode
) => {
  const lights = (engineContext.runtime.app as pc.Application).root
    .findComponents('light')
    .map((l) => (l as pc.LightComponent).type);

  return (
    [node, sibling]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => nodeCacheKey(graph, n))
      .join('-') +
    '|Lights:' +
    lights.join(',') +
    '|Envtex:' +
    'UNKNOWN'
    // scene.environmentTexture
  );
};

const cacher = async (
  engineContext: EngineContext,
  graph: Graph,
  node: SourceNode,
  sibling: SourceNode,
  newValue: (...args: any[]) => Promise<any>
) => {
  const cacheKey = programCacheKey(engineContext, graph, node, sibling);

  if (engineContext.runtime.cache.data[cacheKey]) {
    log(`Cache hit "${cacheKey}"`);
  } else {
    log(`Cache miss "${cacheKey}"`);
  }
  const materialData = await (engineContext.runtime.cache.data[cacheKey] ||
    newValue());
  log(`Material cache "${cacheKey}" is now`, materialData);

  engineContext.runtime.cache.data[cacheKey] = materialData;
  engineContext.runtime.engineMaterial = materialData.material;

  // TODO: We mutate the nodes here, can we avoid that later?
  node.source =
    node.stage === 'fragment' ? materialData.fragment : materialData.vertex;
  sibling.source =
    sibling.stage === 'fragment' ? materialData.fragment : materialData.vertex;
};

const onBeforeCompileMegaShader = async (
  engineContext: EngineContext,
  graph: Graph,
  node: SourceNode,
  sibling: SourceNode
): Promise<{
  material: pc.Material;
  fragment: string;
  vertex: string;
}> => {
  const { app: appUn, sceneData } = engineContext.runtime;
  const app = appUn as pc.Application;

  const pbrName = `engine_pbr${id()}`;
  const shaderMaterial = new pc.StandardMaterial();
  shaderMaterial.name = pbrName;

  const newProperties = {
    ...(node.config.hardCodedProperties ||
      sibling.config.hardCodedProperties ||
      {}),
  };
  Object.assign(shaderMaterial, newProperties);
  const applied = applyPlayMaterialProperties(
    shaderMaterial,
    app,
    graph,
    node,
    sibling
  );
  log('Engine megashader initial properties', { ...newProperties, ...applied });

  let vertexSource: string;
  let fragmentSource: string;

  // This is a hack to force the material to regenerate. The chunks are used
  // internally in playcanvas to generate the material cache key. If you use
  // a real chunk, it messes up the GLSL. So this introduces a fake chunk that
  // isn't used in the GLSL, but forces a new material to generate. The code
  // path I'm hacking through is:
  // render() -> renderForward() -> updatePassShader() -> getShaderVariant() ->
  // library.getProgram() -> generateShaderDefinition()
  // TODO: Try using the new hook https://github.com/playcanvas/engine/pull/5524
  shaderMaterial.chunks.engineHackSource = `${Math.random()}`;

  shaderMaterial.clearVariants();
  shaderMaterial.update();

  const origMat = sceneData.mesh.render.meshInstances[0].material;
  sceneData.mesh.render.meshInstances[0].material = shaderMaterial;

  // Force shader compilation
  app.render();

  sceneData.mesh.render.meshInstances[0].material = origMat;

  return new Promise((resolve) => {
    const variants = Object.values(shaderMaterial.variants) as any[];
    if (variants.length === 1) {
      const { fshader, vshader } = variants[0].definition;
      fragmentSource = fshader;
      vertexSource = vshader;
      engineContext.runtime.cache.nodes[node.id] = {
        fragment: fshader,
        vertex: vshader,
      };
    } else {
      console.error('Bad variants!', variants);
    }

    resolve({
      material: shaderMaterial,
      fragment: fragmentSource,
      vertex: vertexSource,
    });
  });
};

// TODO: NEED TO DO SAME THREE MANGLIGN STEP HERE
const megaShaderMainpulateAst: NodeParser['manipulateAst'] = (
  engineContext,
  engine,
  graph,
  node,
  ast,
  inputEdges
) => {
  const programAst = ast as Program;
  const mainName = 'main' || nodeName(node);

  if (node.stage === 'vertex') {
    if (doesLinkThruShader(graph, node)) {
      returnGlPositionHardCoded(mainName, programAst, 'vec3', 'transformed');
    } else {
      returnGlPosition(mainName, programAst);
    }
  }

  // We specify engine nodes are mangle: false, which is the graph step that
  // handles renaming the main fn, so we have to do it ourselves
  mangleMainFn(programAst, node);
  return programAst;
};

const evaluateNode = (node: DataNode) => {
  if (node.type === 'number') {
    return parseFloat(node.value);
  }

  if (node.type === 'vector2') {
    return new pc.Vec2(parseFloat(node.value[0]), parseFloat(node.value[1]));
  } else if (node.type === 'vector3') {
    return new pc.Vec3(
      parseFloat(node.value[0]),
      parseFloat(node.value[1]),
      parseFloat(node.value[2])
    );
  } else if (node.type === 'vector4') {
    return new pc.Vec4(
      parseFloat(node.value[0]),
      parseFloat(node.value[1]),
      parseFloat(node.value[2]),
      parseFloat(node.value[3])
    );
  } else if (node.type === 'rgb') {
    return new pc.Color(
      parseFloat(node.value[0]),
      parseFloat(node.value[1]),
      parseFloat(node.value[2]),
      1
    );
  } else if (node.type === 'rgba') {
    return new pc.Color(
      parseFloat(node.value[0]),
      parseFloat(node.value[1]),
      parseFloat(node.value[2]),
      parseFloat(node.value[3])
    );
  } else {
    return node.value;
  }
};

export const playengine: Engine = {
  name: 'playcanvas',
  importers,
  mergeOptions: {
    includePrecisions: true,
    includeVersion: false,
  },
  evaluateNode,
  constructors: {
    [EngineNodeType.physical]: physicalNode,
    [EngineNodeType.toon]: toonNode,
  },
  // TODO: Move into core based on engine shader scrape
  preserve: new Set<string>([
    // Attributes
    'position',
    'normal',
    'uv',
    'uv2',
    // varyings
    'vUv0',
    'time',
  ]),
  parsers: {
    [NodeType.SOURCE]: {
      manipulateAst: (engineContext, engine, graph, node, ast, inputEdges) => {
        const programAst = ast as Program;
        const mainName = 'main' || nodeName(node);

        // This hinges on the vertex shader calling vec3(p)
        if (node.stage === 'vertex') {
          if (doesLinkThruShader(graph, node)) {
            returnGlPositionVec3Right(mainName, programAst);
          } else {
            returnGlPosition(mainName, programAst);
          }
        }
        return ast;
      },
    },
    [EngineNodeType.physical]: {
      onBeforeCompile: (graph, engineContext, node, sibling) =>
        cacher(engineContext, graph, node, sibling as SourceNode, () =>
          onBeforeCompileMegaShader(
            engineContext,
            graph,
            node,
            sibling as SourceNode
          )
        ),
      manipulateAst: megaShaderMainpulateAst,
    },
  },
};

playengine.parsers[EngineNodeType.toon] =
  playengine.parsers[EngineNodeType.physical];
playengine.parsers[EngineNodeType.phong] =
  playengine.parsers[EngineNodeType.physical];
