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

const playMaterialProperties = (
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

        // Initialize the property on the material
        if (property.type === 'texture') {
          acc[property.property] = new pc.Texture(app.graphicsDevice);
        } else if (property.type === 'number') {
          acc[property.property] = 0.5;
        } else if (property.type === 'rgb') {
          acc[property.property] = new pc.Color(1, 1, 1);
        } else if (property.type === 'rgba') {
          acc[property.property] = new pc.Color(1, 1, 1, 1);
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
      // TODO?
      hardCodedProperties: {},
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
  // material: any;
  // index: number;
  // threeTone: any;
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
  // The megashader source is dependent on scene information, like the number
  // and type of lights in the scene. This kinda sucks - it's duplicating
  // three's material cache key, and is coupled to how three builds shaders
  const scene = engineContext.runtime.scene as pc.Scene;
  const lights: string[] = [];
  //scene.getNodes().filter((n) => n instanceof pc.Light);

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
  const { app, sceneData } = engineContext.runtime;

  const pbrName = `engine_pbr${id()}`;
  const shaderMaterial = new pc.StandardMaterial();

  const newProperties = {
    ...(node.config.hardCodedProperties ||
      sibling.config.hardCodedProperties ||
      {}),
    ...playMaterialProperties(app, graph, node, sibling),
  };
  Object.assign(shaderMaterial, newProperties);
  log('Engine megashader initial properties', newProperties);

  let vertexSource: string;
  let fragmentSource: string;

  // This was a previous attempt to do what's done in submeshes below
  // const nodeCache = engineContext.runtime.cache.nodes;
  // fragmentSource =
  //   nodeCache[node.id]?.fragment ||
  //   nodeCache[node.nextStageNodeId || 'unknown']?.fragment;
  // vertexSource =
  //   nodeCache[node.id]?.vertex ||
  //   nodeCache[node.nextStageNodeId || 'unknown']?.vertex;

  // log('playengine meshInstances', sceneData.mesh.meshInstances);
  // log(
  //   'playengine model.meshInstances',
  //   sceneData.mesh?.model?.meshInstances
  // );
  // log(
  //   'playengine findComponents',
  //   sceneData.mesh.findComponents('render')
  // );

  // test
  // shaderMaterial.diffuse.set(0, 1, 0);

  console.log('wtf', shaderMaterial.diffuseMap, shaderMaterial.normalMap);
  // shaderMaterial.diffuseMap = new pc.Texture(app.graphicsDevice);
  // shaderMaterial.normalMap = new pc.Texture(app.graphicsDevice);

  // todo: do I need this?

  // @ts-ignore
  shaderMaterial.chunks.hackSource = Math.random();
  shaderMaterial.update();
  shaderMaterial.clearVariants();

  // TODO: Trying to update mesh material here
  // app.render();

  const origMat = sceneData.mesh.model.meshInstances[0].material;
  sceneData.mesh.model.meshInstances[0].material = shaderMaterial;
  console.log('before render', shaderMaterial.variants);
  // render() -> renderForward() -> updatePassShader() -> getShaderVariant() ->
  // library.getProgram() -> generateShaderDefinition()
  // This code path appears to create a new shader but somehow use the old fshader/vshader.
  app.render();
  console.log(
    'after render',
    shaderMaterial.variants,
    'materialId',
    shaderMaterial.id
  );
  sceneData.mesh.model.meshInstances[0].material = origMat;

  return new Promise((resolve) => {
    // @ts-ignore
    window.shaderMaterial = shaderMaterial;
    // log('shaderMaterial', shaderMaterial);
    const variants = Object.values(shaderMaterial.variants) as any[];
    if (variants.length === 1) {
      const { fshader, vshader } = variants[0].definition;
      log('Captured variant shader', { fshader, vshader, variants });
      fragmentSource = fshader;
      vertexSource = vshader;
      engineContext.runtime.cache.nodes[node.id] = {
        // fragmentRef,
        // vertexRef,
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
  // TODO: Get from uniform lib?
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
