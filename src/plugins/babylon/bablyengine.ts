import {
  PBRMaterial,
  Camera,
  Scene,
  Texture,
  Light,
  Material,
  MaterialDefines,
  Vector2,
  Vector3,
  Vector4,
  Color3,
  Color4,
} from 'babylonjs';
import { Engine, EngineNodeType, EngineContext } from '../../engine';
import {
  doesLinkThruShader,
  prepopulatePropertyInputs,
  mangleMainFn,
} from '../../graph/graph';
import { ShaderStage, Graph, NodeType } from '../../graph/graph-types';
import importers from './importers';

import {
  returnGlPositionHardCoded,
  returnGlPosition,
  returnGlPositionVec3Right,
} from '../../util/ast';

import { Program } from '@shaderfrog/glsl-parser/ast';
import {
  CodeNode,
  NodeProperty,
  property,
  SourceNode,
} from '../../graph/code-nodes';

import {
  namedAttributeStrategy,
  texture2DStrategy,
  uniformStrategy,
} from '../../strategy';
import { NodePosition } from '../../graph/base-node';
import { DataNode, UniformDataType } from '../../graph/data-nodes';
import { NodeParser } from '../../graph/parsers';
import indexById from '../../util/indexByid';

// Setting these properties on the material have side effects, not just for the
// GLSL, but for the material itself in JS memory apparently, maybe the bound
// uniforms?. The material we create in babylengine must have the same initial
// properties as those in BabylonComponent or else there will be errors with
// uniforms
export const physicalDefaultProperties: Partial<
  Record<keyof PBRMaterial, any>
> = {
  forceIrradianceInFragment: true,
  albedoColor: new Color3(1.0, 1.0, 1.0),
  metallic: 0.0,
  roughness: 1.0,
};

const log = (...args: any[]) =>
  console.log.call(console, '\x1b[33m(babylengine)\x1b[0m', ...args);

const babylonHackCache: Record<string, { fragment: string; vertex: string }> =
  {};

export const physicalNode = (
  id: string,
  name: string,
  position: NodePosition,
  uniforms: UniformDataType[],
  stage: ShaderStage | undefined,
): CodeNode =>
  prepopulatePropertyInputs({
    id,
    name: 'PBRMaterial',
    position,
    engine: true,
    type: EngineNodeType.physical,
    config: {
      uniforms,
      version: 3,
      mangle: false,
      preprocess: true,
      properties: [
        property('Base Color', 'baseColor', 'rgb', '?????'),
        property('Color', 'albedoColor', 'rgb', 'uniform_vAlbedoColor'),
        property('Texture', 'albedoTexture', 'texture', 'filler_albedoSampler'),
        property('Bump Map', 'bumpTexture', 'texture', 'filler_bumpSampler'),
        property('Metalness', 'metallic', 'number'),
        property('Roughness', 'roughness', 'number'),
        property('Env Map', 'environmentTexture', 'samplerCube'),
        property('Reflection Texture', 'reflectionTexture', 'samplerCube'),
        property('Refraction Texture', 'refractionTexture', 'samplerCube'),
        property('Index Of Refraction', 'indexOfRefraction', 'number'),
        property('Alpha', 'alpha', 'number'),
        property('Direct Intensity', 'directIntensity', 'number'),
        property('Environment Intensity', 'environmentIntensity', 'number'),
        property('Camera Exposure', 'cameraExposure', 'number'),
        property('Camera Contrast', 'cameraContrast', 'number'),
        property('Micro Surface', 'microSurface', 'number'),
        property('Reflectivity Color', 'reflectivityColor', 'rgb'),
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
        dataType: 'vector4',
        category: 'data',
        id: '1',
      },
    ],
    source: '',
    stage,
  });

export type RuntimeContext = {
  scene: Scene;
  camera: Camera;
  BABYLON: any;
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
  position: NodePosition,
  uniforms: UniformDataType[],
  stage: ShaderStage | undefined,
): CodeNode =>
  prepopulatePropertyInputs({
    id,
    name,
    position,
    engine: true,
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
          'filler_gradientMap',
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
        dataType: 'vector4',
        category: 'data',
        id: '1',
      },
    ],
    source: '',
    stage,
  });

const babylonMaterialProperties = (
  scene: Scene,
  graph: Graph,
  node: SourceNode,
  sibling?: SourceNode,
): Record<string, any> => {
  // Find inputs to this node that are dependent on a property of the material
  const propertyInputs = indexById(node.inputs.filter((i) => i.property));

  // Then look for any edges into those inputs and set the material property
  const props = graph.edges
    .filter((edge) => edge.to === node.id || edge.to === sibling?.id)
    .reduce<Record<string, any>>((acc, edge) => {
      // Check if we've plugged into an input for a property
      const propertyInput = propertyInputs[edge.input];
      if (propertyInput) {
        // Find the property itself
        const property = (node.config.properties || []).find(
          (p) => p.property === propertyInput.property,
        ) as NodeProperty;

        // Initialize the property on the material
        if (property.type === 'texture') {
          acc[property.property] = new Texture('', scene);
        } else if (property.type === 'number') {
          acc[property.property] = 0.5;
        } else if (property.type === 'rgb') {
          acc[property.property] = new Color3(1, 1, 1);
        } else if (property.type === 'rgba') {
          acc[property.property] = new Color4(1, 1, 1, 1);
        }
      }
      return acc;
    }, {});
  return props;
};

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
  sibling?: SourceNode,
) => {
  // The megashader source is dependent on scene information, like the number
  // and type of lights in the scene. This kinda sucks - it's duplicating
  // three's material cache key, and is coupled to how three builds shaders
  const scene = engineContext.runtime.scene as Scene;
  const lights = scene.getNodes().filter((n) => n instanceof Light);

  return (
    ([node, sibling] as SourceNode[])
      .filter((n) => !!n)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => nodeCacheKey(graph, n))
      .join('-') +
    '|Lights:' +
    lights.join(',') +
    '|Envtex:' +
    scene.environmentTexture
  );
};

const cacher = async (
  engineContext: EngineContext,
  graph: Graph,
  node: SourceNode,
  sibling: SourceNode | undefined,
  newValue: (...args: any[]) => Promise<any>,
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
  if (sibling) {
    sibling.source =
      sibling.stage === 'fragment'
        ? materialData.fragment
        : materialData.vertex;
  }
};

const onBeforeCompileMegaShader = async (
  engineContext: EngineContext,
  graph: Graph,
  node: SourceNode,
  sibling?: SourceNode,
): Promise<{
  material: Material;
  fragment: string;
  vertex: string;
}> => {
  const { scene, sceneData } = engineContext.runtime;

  const pbrName = `engine_pbr${id()}`;
  const shaderMaterial = new PBRMaterial(pbrName, scene);

  shaderMaterial.linkRefractionWithTransparency = true;
  shaderMaterial.subSurface.isRefractionEnabled = true;
  const newProperties = {
    ...(node.config.hardCodedProperties ||
      sibling?.config?.hardCodedProperties ||
      {}),
    ...babylonMaterialProperties(scene, graph, node, sibling),
  };
  Object.assign(shaderMaterial, newProperties);
  log('Engine megashader initial properties', { newProperties });

  let vertexSource: string;
  let fragmentSource: string;

  // This was a previous attempt to do what's done in submeshes below
  // const nodeCache = engineContext.runtime.cache.nodes;
  // fragmentSource =
  //   nodeCache[node.id]?.fragment ||
  // vertexSource =
  //   nodeCache[node.id]?.vertex ||

  const genHackCacheKey = (unknown: MaterialDefines | string[]) =>
    unknown.toString();
  let hackKey: string;

  return new Promise((resolve) => {
    shaderMaterial.customShaderNameResolve = (
      shaderName,
      uniforms,
      uniformBuffers,
      samplers,
      defines,
      attributes,
      options,
    ) => {
      hackKey = genHackCacheKey(defines);
      log('Babylengine creating new shader', {
        uniforms,
        uniformBuffers,
        samplers,
        defines,
        attributes,
        options,
      });
      if (options) {
        options.processFinalCode = (type, code) => {
          // If babylon thinks it has cached code for a new shader,
          // processFinalCode doesn't get called. This hack attempt is to try to
          // recreate Babylon's internal cache, based on my understanding that
          // babylon looks to the defines to determine shader uniqueness
          babylonHackCache[hackKey] = babylonHackCache[hackKey] || {
            fragment: '',
            vertex: '',
          };
          if (type === 'vertex') {
            log('captured vertex code', { code });
            vertexSource = code;
            babylonHackCache[hackKey].vertex = code;
            return code;
          } else if (type === 'fragment') {
            log('captured fragment code', { code });
            fragmentSource = code;
            babylonHackCache[hackKey].fragment = code;
            return code;
          }
          throw new Error(`Unknown type ${type}`);
        };
      } else {
        console.warn('No options for', pbrName);
      }
      return shaderName;
    };

    if (!sceneData.mesh) {
      log('🍃 EFF, no MESHREF RENDER()....');
    }
    shaderMaterial.forceCompilation(sceneData.mesh, (compiledMaterial) => {
      log('Babylon shader compilation done!');
      if (!fragmentSource || !vertexSource) {
        log('Reusing previous mesh render...');
        vertexSource = babylonHackCache[hackKey]?.vertex;
        fragmentSource = babylonHackCache[hackKey]?.fragment;
      }

      if (!fragmentSource || !vertexSource) {
        debugger;
      }
      log('captured', { fragmentSource, vertexSource });

      if (node.stage === 'fragment') {
        node.source = fragmentSource;
      }
      if (sibling?.stage === 'fragment') {
        sibling.source = fragmentSource;
      }
      if (node.stage === 'vertex') {
        node.source = vertexSource;
      }
      if (sibling?.stage === 'vertex') {
        sibling.source = vertexSource;
      }

      engineContext.runtime.cache.nodes[node.id] = {
        // fragmentRef,
        // vertexRef,
        fragment: fragmentSource,
        vertex: vertexSource,
      };

      // This doesn't appear to do anything (see comment above submeshes)
      compiledMaterial.dispose(true);

      resolve({
        material: compiledMaterial,
        fragment: fragmentSource,
        vertex: vertexSource,
      });
    });
  });
};

// TODO: NEED TO DO SAME THREE MANGLIGN STEP HERE
const megaShaderMainpulateAst: NodeParser['manipulateAst'] = (
  engineContext,
  engine,
  graph,
  ast,
  inputEdges,
  node,
  sibling,
) => {
  const programAst = ast as Program;
  const mainName = 'main';

  if (node.stage === 'vertex') {
    if (doesLinkThruShader(graph, node)) {
      returnGlPositionHardCoded(mainName, programAst, 'vec3', 'transformed');
    } else {
      returnGlPosition(mainName, programAst);
    }
  }

  // We specify engine nodes are mangle: false, which is the graph step that
  // handles renaming the main fn, so we have to do it ourselves
  mangleMainFn(programAst, node, sibling);
  return programAst;
};

const evaluateNode = (node: DataNode) => {
  if (node.type === 'number') {
    return parseFloat(node.value);
  }

  if (node.type === 'vector2') {
    return new Vector2(parseFloat(node.value[0]), parseFloat(node.value[1]));
  } else if (node.type === 'vector3') {
    return new Vector3(
      parseFloat(node.value[0]),
      parseFloat(node.value[1]),
      parseFloat(node.value[2]),
    );
  } else if (node.type === 'vector4') {
    return new Vector4(
      parseFloat(node.value[0]),
      parseFloat(node.value[1]),
      parseFloat(node.value[2]),
      parseFloat(node.value[3]),
    );
  } else if (node.type === 'rgb') {
    return new Color3(
      parseFloat(node.value[0]),
      parseFloat(node.value[1]),
      parseFloat(node.value[2]),
    );
  } else if (node.type === 'rgba') {
    return new Color4(
      parseFloat(node.value[0]),
      parseFloat(node.value[1]),
      parseFloat(node.value[2]),
      parseFloat(node.value[3]),
    );
  } else {
    return node.value;
  }
};

export const babylengine: Engine = {
  name: 'babylon',
  displayName: 'Babylon.js',
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
    'viewProjection',
    'normalMatrix',
    'vAmbientInfos',
    'vOpacityInfos',
    'vEmissiveInfos',
    'vLightmapInfos',
    'vReflectivityInfos',
    'vMicroSurfaceSamplerInfos',
    'vReflectionInfos',
    'vReflectionFilteringInfo',
    'vReflectionPosition',
    'vReflectionSize',
    'vBumpInfos',
    'albedoMatrix',
    'ambientMatrix',
    'opacityMatrix',
    'emissiveMatrix',
    'lightmapMatrix',
    'reflectivityMatrix',
    'microSurfaceSamplerMatrix',
    'bumpMatrix',
    'bumpSampler',
    'vTangentSpaceParams',
    'reflectionMatrix',
    'vReflectionColor',
    'vAlbedoColor',
    'vLightingIntensity',
    'vReflectionMicrosurfaceInfos',
    'pointSize',
    'vReflectivityColor',
    'vEmissiveColor',
    'visibility',
    'vMetallicReflectanceFactors',
    'vMetallicReflectanceInfos',
    'metallicReflectanceMatrix',
    'vClearCoatParams',
    'vClearCoatRefractionParams',
    'vClearCoatInfos',
    'clearCoatMatrix',
    'clearCoatRoughnessMatrix',
    'vClearCoatBumpInfos',
    'vClearCoatTangentSpaceParams',
    'clearCoatBumpMatrix',
    'vClearCoatTintParams',
    'clearCoatColorAtDistance',
    'vClearCoatTintInfos',
    'clearCoatTintMatrix',
    'vAnisotropy',
    'vAnisotropyInfos',
    'anisotropyMatrix',
    'vSheenColor',
    'vSheenRoughness',
    'vSheenInfos',
    'sheenMatrix',
    'sheenRoughnessMatrix',
    'vRefractionMicrosurfaceInfos',
    'vRefractionFilteringInfo',
    'vRefractionInfos',
    'refractionMatrix',
    'vThicknessInfos',
    'thicknessMatrix',
    'vThicknessParam',
    'vDiffusionDistance',
    'vTintColor',
    'vSubSurfaceIntensity',
    'scatteringDiffusionProfile',
    'vDetailInfos',
    'detailMatrix',
    'Scene',
    'vEyePosition',
    'vAmbientColor',
    'vCameraInfos',
    'vPositionW',
    'vMainUV1',
    'vNormalW',
    'Light0',
    'albedoSampler',
    'environmentBrdfSampler',
    'position',
    'normal',
    'uv',
    'world',
    'Light0',
    'Light1',
    'Light2',
    'Light3',
    'light0',
    'light1',
    'light2',
    'light3',
    'vLightData0',
    'vLightDiffuse0',
    'vLightSpecular0',
    'vLightFalloff0',
    'vSphericalL00',
    'vSphericalL1_1',
    'vSphericalL10',
    'vSphericalL11',
    'vSphericalL2_2',
    'vSphericalL2_1',
    'vSphericalL20',
    'vSphericalL21',
    'vSphericalL22',
    'vAlbedoInfos',
    'reflectionSampler',
    // passed by shaderfrog. maybe should have separate names? duplicated across
    // all the engines.
    'time',
    'renderResolution',
  ]),
  parsers: {
    [NodeType.SOURCE]: {
      manipulateAst: (
        engineContext,
        engine,
        graph,
        ast,
        inputEdges,
        node,
        sibling,
      ) => {
        const programAst = ast as Program;
        const mainName = 'main';

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
        cacher(engineContext, graph, node, sibling, () =>
          onBeforeCompileMegaShader(engineContext, graph, node, sibling),
        ),
      manipulateAst: megaShaderMainpulateAst,
    },
  },
};

babylengine.parsers[EngineNodeType.toon] =
  babylengine.parsers[EngineNodeType.physical];
babylengine.parsers[EngineNodeType.phong] =
  babylengine.parsers[EngineNodeType.physical];
