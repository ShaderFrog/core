import {
  ShaderLib,
  RawShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  Color,
  GLSL3,
  Light,
  Texture,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshToonMaterial,
  Scene,
  WebGLRenderer,
  PerspectiveCamera,
} from 'three';
import { Program } from '@shaderfrog/glsl-parser/ast';
import { Graph, NodeType, ShaderStage } from '../../graph/graph-types';
import { prepopulatePropertyInputs, mangleMainFn } from '../../graph/graph';
import importers from './importers';

import { Engine, EngineContext, EngineNodeType } from '../../engine';
import { doesLinkThruShader, CompileResult } from '../../graph/graph';
import {
  returnGlPosition,
  returnGlPositionHardCoded,
  returnGlPositionVec3Right,
} from '../../util/ast';
import {
  CodeNode,
  NodeProperty,
  property,
  SourceNode,
} from '../../graph/code-nodes';
import { NodePosition } from '../../graph/base-node';
import { DataNode, UniformDataType } from '../../graph/data-nodes';
import {
  namedAttributeStrategy,
  texture2DStrategy,
  uniformStrategy,
} from '../../strategy';
import { NodeParser } from '../../graph/parsers';
import indexById from '@/core/util/indexByid';

const log = (...args: any[]) =>
  console.log.call(console, '\x1b[35m(three)\x1b[0m', ...args);

export const phongNode = (
  id: string,
  name: string,
  position: NodePosition,
  uniforms: UniformDataType[],
  stage: ShaderStage | undefined
): CodeNode =>
  prepopulatePropertyInputs({
    id,
    name: 'MeshPhongMaterial',
    position,
    engine: true,
    type: EngineNodeType.phong,
    config: {
      version: 3,
      uniforms,
      preprocess: true,
      mangle: false,
      properties: [
        property('Color', 'color', 'rgb', 'uniform_diffuse'),
        property('Emissive', 'emissive', 'rgb', 'uniform_emissive'),
        property(
          'Emissive Map',
          'emissiveMap',
          'texture',
          'filler_emissiveMap'
        ),
        property(
          'Emissive Intensity',
          'emissiveIntensity',
          'number',
          'uniform_emissive'
        ),
        property('Texture', 'map', 'texture', 'filler_map'),
        property('Normal Map', 'normalMap', 'texture', 'filler_normalMap'),
        property('Normal Scale', 'normalScale', 'vector2'),
        property('AO Map', 'aoMap', 'texture', 'filler_aoMap'),
        property(
          'AO Intensity',
          'aoMapIntensity',
          'number',
          'filler_aoMapIntensity'
        ),
        property('Shininess', 'shininess', 'number'),
        property('Reflectivity', 'reflectivity', 'number'),
        property('Refraction Ratio', 'refractionRatio', 'number'),
        property('Specular', 'specular', 'rgb', 'uniform_specular'),
        property(
          'Specular Map',
          'specularMap',
          'texture',
          'filler_specularMap'
        ),
        property(
          'Displacement Map',
          'displacementMap',
          'texture',
          'filler_displacementMap'
        ),
        property('Displacement Scale', 'displacementScale', 'number'),
        property('Bump Map', 'bumpMap', 'texture', 'filler_bumpMap'),
        property('Bump Scale', 'bumpScale', 'number'),
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

export const physicalNode = (
  id: string,
  name: string,
  position: NodePosition,
  uniforms: UniformDataType[],
  stage: ShaderStage | undefined
): CodeNode =>
  prepopulatePropertyInputs({
    id,
    name: 'MeshPhysicalMaterial',
    position,
    engine: true,
    type: EngineNodeType.physical,
    config: {
      uniforms,
      version: 3,
      mangle: false,
      preprocess: true,
      properties: [
        property('Color', 'color', 'rgb', 'uniform_diffuse'),
        property('Texture', 'map', 'texture', 'filler_map'),
        property('Opacity', 'opacity', 'number'),
        property('Normal Map', 'normalMap', 'texture', 'filler_normalMap'),
        property('Normal Scale', 'normalScale', 'vector2'),
        property('AO Map', 'aoMap', 'texture', 'filler_aoMap'),
        property(
          'AO Intensity',
          'aoMapIntensity',
          'number',
          'filler_aoMapIntensity'
        ),
        property('Metalness', 'metalness', 'number', 'uniform_metalness'),
        property('Roughness', 'roughness', 'number', 'uniform_roughness'),
        property(
          'Roughness Map',
          'roughnessMap',
          'texture',
          'filler_roughnessMap'
        ),
        property(
          'Displacement Map',
          'displacementMap',
          'texture',
          'filler_displacementMap'
        ),
        property('Displacement Scale', 'displacementScale', 'number'),
        // MeshPhysicalMaterial gets envMap from the scene. MeshStandardMaterial
        // gets it from the material
        // property('Env Map', 'envMap', 'samplerCube'),
        property(
          'Env Map Intensity',
          'envMapIntensity',
          'number',
          'uniform_envMapIntensity'
        ),
        property('Transmission', 'transmission', 'number'),
        property(
          'Transmission Map',
          'transmissionMap',
          'texture',
          'filler_transmissionMap'
        ),
        property('Thickness', 'thickness', 'number'),
        property('Index of Refraction', 'ior', 'number'),
        // Sheen only works with directional lights?
        // https://discourse.threejs.org/t/meshphysicalmaterial-s-sheen/31901/6
        // property('Sheen', 'sheen', 'number'),
        property('Reflectivity', 'reflectivity', 'number'),
        property('Clearcoat', 'clearcoat', 'number'),
        property('Iridescence', 'iridescence', 'number'),
        property('Iridescence IOR', 'iridescenceIOR', 'number'),
        property(
          'Iridescence Thickness Range',
          'iridescenceThicknessRange',
          'array',
          undefined,
          ['100', '400']
        ),
      ],
      hardCodedProperties: {
        isMeshPhysicalMaterial: true,
        isMeshStandardMaterial: true,
      },
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

const cacher = (
  engineContext: EngineContext,
  graph: Graph,
  node: SourceNode,
  sibling: SourceNode | undefined,
  newValue: (...args: any[]) => any
) => {
  const cacheKey = programCacheKey(engineContext, graph, node, sibling);

  if (engineContext.runtime.cache.data[cacheKey]) {
    log('Cache hit', cacheKey);
  } else {
    log('Cache miss', cacheKey);
  }
  const materialData = engineContext.runtime.cache.data[cacheKey] || newValue();

  engineContext.runtime.cache.data[cacheKey] = materialData;
  engineContext.runtime.engineMaterial = materialData.material;

  engineContext.runtime.cache.nodes[node.id] = {
    ...(engineContext.runtime.cache.nodes[node.id] || {}),
    computedSource:
      node.stage === 'fragment' ? materialData.fragment : materialData.vertex,
  };

  // return {
  //   ...node,
  //   source:
  //   node.stage === 'fragment' ? materialData.fragment : materialData.vertex;
  // }

  // TODO: We mutate the nodes here, can we avoid that later?
  // node.source =
  //   node.stage === 'fragment' ? materialData.fragment : materialData.vertex;
  // if (sibling) {
  //   sibling.source =
  //     sibling.stage === 'fragment'
  //       ? materialData.fragment
  //       : materialData.vertex;
  // }
};

const onBeforeCompileMegaShader = (
  engineContext: EngineContext,
  newMat: any
) => {
  log('compiling three megashader!');
  const { renderer, sceneData, scene, camera } = engineContext.runtime;
  const { mesh } = sceneData;

  // Temporarily swap the mesh material to the new one, since materials can
  // be mesh specific, render, then get its source code
  const originalMaterial = mesh.material;
  mesh.material = newMat;
  renderer.compile(scene, camera);

  // The references to the compiled shaders in WebGL
  const fragmentRef = renderer.properties
    .get(mesh.material)
    .programs.values()
    .next().value.fragmentShader;
  const vertexRef = renderer.properties
    .get(mesh.material)
    .programs.values()
    .next().value.vertexShader;

  const gl = renderer.getContext();
  const fragment = gl.getShaderSource(fragmentRef);
  const vertex = gl.getShaderSource(vertexRef);

  // Reset the material on the mesh, since the shader we're computing context
  // for might not be the one actually want on the mesh - like if a toon node
  // was added to the graph but not connected
  mesh.material = originalMaterial;

  // Do we even need to do this? This is just for debugging right? Using the
  // source on the node is the important thing.
  return {
    material: newMat,
    fragmentRef,
    vertexRef,
    fragment,
    vertex,
  };
};

const megaShaderMainpulateAst: NodeParser['manipulateAst'] = (
  engineContext,
  engine,
  graph,
  ast,
  inputEdges,
  node,
  sibling
) => {
  const programAst = ast as Program;
  const mainName = 'main'; // || nodeName(node);
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
  sibling?: SourceNode
) => {
  // The megashader source is dependent on scene information, like the number
  // and type of lights in the scene. This kinda sucks - it's duplicating
  // three's material cache key, and is coupled to how three builds shaders
  const { scene } = engineContext.runtime;
  const lights: string[] = [];
  scene.traverse((obj: any) => {
    if (obj instanceof Light) {
      lights.push(obj.uuid);
    }
  });

  return (
    ([node, sibling] as SourceNode[])
      .filter((n) => !!n)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((n) => nodeCacheKey(graph, n))
      .join('-') +
    '|Lights:' +
    lights.join(',') +
    '|Bg:' +
    scene.background?.uuid +
    '|Env:' +
    scene.environment?.uuid
  );
};

export const defaultPropertySetting = (property: NodeProperty) => {
  if (property.type === 'texture') {
    return new Texture();
  } else if (property.type === 'number') {
    return 0.5;
  } else if (property.type === 'rgb') {
    return new Color(1, 1, 1);
  } else if (property.type === 'rgba') {
    return new Vector4(1, 1, 1, 1);
  }
};

const threeMaterialProperties = (
  graph: Graph,
  node: SourceNode,
  sibling?: SourceNode
): Record<string, any> => {
  // Find inputs to this node that are dependent on a property of the material
  const propertyInputs = indexById(node.inputs.filter((i) => i.property));

  // Then look for any edges into those inputs and set the material property
  return graph.edges
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
        acc[property.property] = defaultPropertySetting(property);
      }
      return acc;
    }, {});
};

export type ThreeRuntime = {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  sceneData: any;
  engineMaterial: any;
  loaded: boolean;
  index: number;
  cache: {
    data: {
      [key: string]: any;
    };
    nodes: {
      [id: string]: {
        fragmentRef: any;
        vertexRef: any;
        fragment: string;
        vertex: string;
      };
    };
  };
};

export const stringifyThreeValue = (input: any): string => {
  if (input instanceof Vector2) {
    return `new Vector2(${input.x}, ${input.y})`;
  } else if (input instanceof Vector3) {
    return `new Vector3(${input.x}, ${input.y}, ${input.z})`;
  } else if (input instanceof Vector4) {
    return `new Vector4(${input.x}, ${input.y}, ${input.z}, ${input.w})`;
  } else if (input instanceof Color) {
    return `new Color(${input.r}, ${input.g}, ${input.b})`;
  } else if (input instanceof Texture) {
    return `new Texture()`;
  }
  return `${input}`;
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
      parseFloat(node.value[2])
    );
  } else if (node.type === 'vector4') {
    return new Vector4(
      parseFloat(node.value[0]),
      parseFloat(node.value[1]),
      parseFloat(node.value[2]),
      parseFloat(node.value[3])
    );
  } else if (node.type === 'rgb') {
    return new Color(
      parseFloat(node.value[0]),
      parseFloat(node.value[1]),
      parseFloat(node.value[2])
    );
  } else if (node.type === 'rgba') {
    return new Vector4(
      parseFloat(node.value[0]),
      parseFloat(node.value[1]),
      parseFloat(node.value[2]),
      parseFloat(node.value[3])
    );
  } else {
    return node.value;
  }
};

export const toonNode = (
  id: string,
  name: string,
  position: NodePosition,
  uniforms: UniformDataType[],
  stage: ShaderStage | undefined
): CodeNode =>
  prepopulatePropertyInputs({
    id,
    name: 'MeshToonMaterial',
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
          'filler_gradientMap'
        ),
        property('Normal Map', 'normalMap', 'texture', 'filler_normalMap'),
        property('Normal Scale', 'normalScale', 'vector2'),
        property('AO Map', 'aoMap', 'texture', 'filler_aoMap'),
        property(
          'AO Intensity',
          'aoMapIntensity',
          'number',
          'filler_aoMapIntensity'
        ),
        property(
          'Displacement Map',
          'displacementMap',
          'texture',
          'filler_displacementMap'
        ),
        property('Displacement Scale', 'displacementScale', 'number'),
        property('Env Map', 'envMap', 'samplerCube'),
        property('Env Map Intensity', 'envMapIntensity', 'number'),
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

export const threngine: Engine = {
  name: 'three',
  displayName: 'Three.js',
  importers,
  mergeOptions: {
    includePrecisions: true,
    includeVersion: true,
  },
  evaluateNode,
  constructors: {
    [EngineNodeType.phong]: phongNode,
    [EngineNodeType.physical]: physicalNode,
    [EngineNodeType.toon]: toonNode,
  },
  // TODO: Get from uniform lib?
  preserve: new Set<string>([
    'viewMatrix',
    'modelMatrix',
    'modelViewMatrix',
    'projectionMatrix',
    'normalMatrix',
    'uvTransform',
    // Attributes
    'position',
    'normal',
    'uv',
    'uv2',
    'tangent',
    // Varyings
    'vUv',
    'vUv2',
    'vViewPosition',
    'vNormal',
    'vPosition',
    // Uniforms
    'cameraPosition',
    'isOrthographic',
    'diffuse',
    'emissive',
    'specular',
    'shininess',
    'opacity',
    'map',
    'IncidentLight',
    'ReflectedLight',
    'specularTint',
    'normalScale',
    'normalMap',
    'envMap',
    'envMapIntensity',
    'flipEnvMap',
    'maxMipLevel',
    'roughnessMap',
    // Uniforms for lighting
    'receiveShadow',
    'ambientLightColor',
    'lightProbe',
    // Light uniform arrays
    'spotLights',
    'pointLights',
    // This isn't three wtf
    'resolution',
    'color',
    'image',
    'gradientMap',
    // TODO: This isn't specific to threejs as an engine, it's specific to the
    // phong shader. If a *shader* node has brightness, it should be unique, not
    // use the threejs one!
    'brightness',
    // TODO: These depend on the shaderlib, this might need to be a runtime
    // concern
    // Metalness
    'roughness',
    'metalness',
    'ior',
    'specularIntensity',
    'clearcoat',
    'clearcoatRoughness',
    'transmission',
    'thickness',
    'attenuationDistance',
    'attenuationTint',
    'transmissionSamplerMap',
    'transmissionSamplerSize',
    'displacementMap',
    'displacementScale',
    'displacementBias',
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
        sibling
      ) => {
        const programAst = ast as Program;
        const mainName = 'main'; // || nodeName(node);

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
    [EngineNodeType.phong]: {
      onBeforeCompile: async (graph, engineContext, node, sibling) => {
        cacher(engineContext, graph, node, sibling, () =>
          onBeforeCompileMegaShader(
            engineContext,
            new MeshPhongMaterial({
              // @ts-ignore
              isMeshPhongMaterial: true,
              ...threeMaterialProperties(graph, node, sibling),
            })
          )
        );
      },
      manipulateAst: megaShaderMainpulateAst,
    },
    [EngineNodeType.physical]: {
      onBeforeCompile: async (graph, engineContext, node, sibling) => {
        cacher(engineContext, graph, node, sibling, () =>
          onBeforeCompileMegaShader(
            engineContext,
            new MeshPhysicalMaterial({
              // These properties are copied onto the runtime RawShaderMaterial.
              // These exist on the MeshPhysicalMaterial but only in the
              // prototype. We have to hard code them for Object.keys() to work
              ...node.config.hardCodedProperties,
              ...threeMaterialProperties(graph, node, sibling),
            })
          )
        );
      },
      manipulateAst: megaShaderMainpulateAst,
    },
    [EngineNodeType.toon]: {
      onBeforeCompile: async (graph, engineContext, node, sibling) => {
        cacher(engineContext, graph, node, sibling, () =>
          onBeforeCompileMegaShader(
            engineContext,
            new MeshToonMaterial({
              gradientMap: new Texture(),
              // @ts-ignore
              isMeshToonMaterial: true,
              ...threeMaterialProperties(graph, node, sibling),
            })
          )
        );
      },
      manipulateAst: megaShaderMainpulateAst,
    },
  },
};

export const createMaterial = (
  compileResult: CompileResult,
  ctx: EngineContext
) => {
  const { engineMaterial } = ctx.runtime as ThreeRuntime;

  const finalUniforms = {
    // TODO: Get these from threngine
    ...ShaderLib.phong.uniforms,
    ...ShaderLib.toon.uniforms,
    ...ShaderLib.physical.uniforms,
    time: { value: 0 },
    cameraPosition: { value: new Vector3(1.0) },
    renderResolution: { value: new Vector2(1.0) },
  };

  // Also the ThreeComponent's sceneConfig properties modify the material
  const initialProperties = {
    name: 'ShaderFrog Material',
    lights: true,
    uniforms: {
      ...finalUniforms,
    },
    // See https://github.com/mrdoob/three.js/pull/26809
    glslVersion: GLSL3,
    vertexShader: compileResult?.vertexResult.replace('#version 300 es', ''),
    fragmentShader: compileResult?.fragmentResult.replace(
      '#version 300 es',
      ''
    ),
  };

  const additionalProperties = Object.entries({
    ...engineMaterial,
  })
    .filter(
      ([property]) =>
        // Ignore three material "hidden" properties
        property.charAt(0) !== '_' &&
        // Ignore uuid since it should probably be unique?
        property !== 'uuid' &&
        // I'm not sure what three does with type under the hood, ignore it
        property !== 'type' &&
        // "precision" adds a precision preprocessor line
        property !== 'precision' &&
        // Ignore existing properties
        !(property in initialProperties) &&
        // Ignore STANDARD and PHYSICAL defines to the top of the shader in
        // WebGLProgram
        // https://github.com/mrdoob/three.js/blob/e7042de7c1a2c70e38654a04b6fd97d9c978e781/src/renderers/webgl/WebGLProgram.js#L392
        // which occurs if we set isMeshPhysicalMaterial/isMeshStandardMaterial
        property !== 'defines'
    )
    .reduce(
      (acc, [key, value]) => ({
        ...acc,
        [key]: value,
      }),
      {}
    );

  const material = new RawShaderMaterial(initialProperties);

  // This prevents a deluge of warnings from three on the constructor saying
  // that each of these properties is not a property of the material
  Object.entries(additionalProperties).forEach(([key, value]) => {
    // @ts-ignore
    material[key] = value;
  });

  return material;
};
