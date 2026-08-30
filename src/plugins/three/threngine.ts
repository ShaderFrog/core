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
  DataTexture,
  RGBAFormat,
} from 'three';
import {
  Program,
  FunctionNode,
  ExpressionStatementNode,
  AssignmentNode,
  DeclarationStatementNode,
  DeclaratorListNode,
} from '@shaderfrog/glsl-parser/ast';
import { Graph, NodeType, ShaderStage } from '../../graph/graph-types';
import { prepopulatePropertyInputs, mangleMainFn } from '../../graph/graph';
import importers from './importers';

import { Engine, EngineContext, EngineNodeType } from '../../engine';
import {
  doesLinkThruShader,
  CompileResult,
  EngineNodeProperties,
} from '../../graph/graph';
import {
  filterSections,
  filterQualifiedStatements,
  filterUniformNames,
  findShaderSections,
  shaderSectionsCons,
  LineAndSource,
  ShaderSections,
  shaderSectionsToProgram,
} from '../../graph/shader-sections';
import { generate } from '@shaderfrog/glsl-parser';
import { FrogMaterial, ShaderInjection } from './FrogMaterial';
import {
  makeExpression,
  returnGlPosition,
  returnGlPositionVec3Right,
} from '../../util/ast';
import {
  CodeNode,
  NodeProperty,
  property,
  SourceNode,
} from '../../graph/code-nodes';
import { nodeInput, NodePosition } from '../../graph/base-node';
import { DataNode, UniformDataType } from '../../graph/data-nodes';
import {
  namedAttributeStrategy,
  texture2DStrategy,
  uniformStrategy,
} from '../../strategy';
import { NodeParser } from '../../graph/parsers';
import indexById from '../../util/indexByid';

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
      strategies: [],
    },
    display: {
      visibilities: {
        Uniforms: 'hidden',
      },
    },
    inputs: [
      nodeInput(
        'Position',
        `position`,
        'filler',
        undefined, // Data type for what plugs into this filler
        ['code', 'data'],
        true
      ),
    ],
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
        property('Clearcoat Roughness', 'clearcoatRoughness', 'number'),
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
    display: {
      visibilities: {
        Uniforms: 'hidden',
      },
    },
    inputs:
      // Andy note for migrating: if filler_position is already found on saved
      // shaders, found from computedInputs, it will not need to be
      // reconstructed / migrated
      stage === 'vertex'
        ? [
            nodeInput(
              'Position',
              `filler_position`,
              'filler',
              undefined, // Data type for what plugs into this filler
              ['code', 'data'],
              true
            ),
          ]
        : [],
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
  );
};

const programCacheKey = (
  engineContext: EngineContext,
  graph: Graph,
  node: SourceNode,
  sibling?: SourceNode
) => {
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

const onBeforeCompileMegaShader = (
  engineContext: EngineContext,
  newMat: any
) => {
  log('Compiling three megashader!');
  const { renderer, sceneData, scene, camera } = engineContext.runtime;
  const { mesh } = sceneData;

  // Mirror the defines that FrogMaterial always sets so the force-compiled
  // megashader includes the same conditional declarations (e.g. tangent, vUv).
  newMat.defines = {
    ...(newMat.defines || {}),
    USE_UV: '',
    USE_UV2: '',
    USE_TANGENT: '',
  };

  const originalMaterial = mesh.material;
  mesh.material = newMat;
  renderer.compile(scene, camera);

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

  mesh.material = originalMaterial;

  return {
    material: newMat,
    fragmentRef,
    vertexRef,
    fragment,
    vertex,
  };
};

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

  return {
    computedSource:
      node.stage === 'fragment' ? materialData.fragment : materialData.vertex,
  };
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
      strategies: [],
    },
    display: {
      visibilities: {
        Uniforms: 'hidden',
      },
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
    'vViewPosition',
    'vNormal',
    'vPosition',
    'vWorldPosition',
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
    'gradientMap',
    // Uniforms for lighting
    'receiveShadow',
    'ambientLightColor',
    'lightProbe',
    // Light uniform arrays
    'spotLights',
    'pointLights',
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
      onBeforeCompile: async (graph, engineContext, node, sibling) =>
        cacher(engineContext, graph, node, sibling, () =>
          onBeforeCompileMegaShader(
            engineContext,
            new MeshPhongMaterial({
              // @ts-ignore
              isMeshPhongMaterial: true,
              ...threeMaterialProperties(graph, node, sibling),
            })
          )
        ),
      produceFiller:
        (_node, _ast) =>
        (...args: string[]) =>
          makeExpression(`main_MeshPhongMaterial(${args.join(', ')})`),
    },
    [EngineNodeType.physical]: {
      onBeforeCompile: async (graph, engineContext, node, sibling) =>
        cacher(engineContext, graph, node, sibling, () =>
          onBeforeCompileMegaShader(
            engineContext,
            new MeshPhysicalMaterial({
              ...node.config.hardCodedProperties,
              ...threeMaterialProperties(graph, node, sibling),
            })
          )
        ),
      produceFiller:
        (_node, _ast) =>
        (...args: string[]) =>
          makeExpression(`main_MeshPhysicalMaterial(${args.join(', ')})`),
    },
    [EngineNodeType.toon]: {
      onBeforeCompile: async (graph, engineContext, node, sibling) =>
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
        ),
      produceFiller:
        (_node, _ast) =>
        (...args: string[]) =>
          makeExpression(`main_MeshToonMaterial(${args.join(', ')})`),
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
        // For debugging, these pull in the frogmaterial set properties, which
        // then messes up the rawshadermaterial
        property !== 'onBeforeCompile' &&
        property !== 'userData' &&
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

export const engineNodeTypeToConstructor = (type: string) => {
  if (type === EngineNodeType.physical) return MeshPhysicalMaterial;
  if (type === EngineNodeType.phong) return MeshPhongMaterial;
  if (type === EngineNodeType.toon) return MeshToonMaterial;
  return null;
};

const frogMergeOptions = { includePrecisions: false, includeVersion: false };

const getStructTypeName = (
  stmt: DeclarationStatementNode
): string | undefined => {
  try {
    const specifier = (stmt.declaration as any).specified_type?.specifier
      ?.specifier;
    return specifier?.typeName?.identifier;
  } catch {
    return undefined;
  }
};

const collectThreeNames = (
  sections: ShaderSections
): { uniforms: Set<string>; qualified: Set<string>; structs: Set<string> } => {
  const uniforms = new Set<string>();
  const qualified = new Set<string>();
  const structs = new Set<string>();

  for (const line of sections.uniforms) {
    const decl = line.source.declaration;
    if (decl.type === 'interface_declarator') {
      const id = (decl as any).identifier?.identifier?.identifier;
      if (id) uniforms.add(id);
    } else if (decl.type === 'declarator_list') {
      (decl as DeclaratorListNode).declarations?.forEach((d) =>
        uniforms.add(d.identifier.identifier)
      );
    }
  }

  for (const line of [...sections.inStatements, ...sections.outStatements]) {
    const dec = line.source.declaration as DeclaratorListNode;
    dec.declarations?.forEach((d) => qualified.add(d.identifier.identifier));
  }

  for (const line of sections.structs) {
    const name = getStructTypeName(line.source);
    if (name) structs.add(name);
  }

  return { uniforms, qualified, structs };
};

// Strip top-level declarations that the Three.js megashader already provides,
// so injected user GLSL doesn't redefine them. Uses the parsed megashader
// sections from the engine node context rather than a hardcoded list.
export const stripThreeDeclarations = (
  sections: ShaderSections,
  threeShaderSections: ShaderSections
): ShaderSections => {
  const {
    uniforms: threeUniforms,
    qualified: threeQualified,
    structs: threeStructs,
  } = collectThreeNames(threeShaderSections);

  return {
    ...sections,
    inStatements: filterQualifiedStatements(
      sections.inStatements,
      (name) => !threeQualified.has(name)
    ),
    outStatements: filterQualifiedStatements(
      sections.outStatements,
      (name) => !threeQualified.has(name)
    ),
    uniforms: filterUniformNames(
      sections.uniforms,
      (name) => !threeUniforms.has(name)
    ),
    structs: sections.structs.filter(
      (s) => !threeStructs.has(getStructTypeName(s.source) ?? '')
    ),
  };
};

// Extract the right-hand side of `assignTarget = <expr>` from the output
// node's compiled main function. Works for both code nodes (which produce
// `frogFragOut = main_NodeName()`) and expression nodes (which produce
// `frogFragOut = inlined_expression`).
const extractOutputExpr = (
  sections: ShaderSections,
  outputNodeId: string,
  assignTarget: string,
  fallback: string
): string => {
  const entry = sections.program.find((s) => s.nodeId === outputNodeId);
  if (!entry) return fallback;
  const fn = entry.source as FunctionNode;
  if (fn.type !== 'function') return fallback;
  const body = fn.body;
  for (const stmt of body.statements) {
    const es = stmt as ExpressionStatementNode;
    if (es.type !== 'expression_statement') continue;
    const assign = es.expression as AssignmentNode;
    if (assign.type !== 'assignment') continue;
    const left = assign.left as any;
    if (left?.identifier !== assignTarget) continue;
    return generate(assign.right);
  }
  return fallback;
};

// Extract all statements from the output node's main() body. The
// MAGIC_OUTPUT_STMTS filler prepends orphan vertex main() calls before the
// gl_Position assignment; extractOutputExpr only grabs the RHS and drops them.
const extractVertexMainStmts = (
  sections: ShaderSections,
  outputNodeId: string,
  fallback: string
): string => {
  const entry = sections.program.find((s) => s.nodeId === outputNodeId);
  if (!entry) return `gl_Position = ${fallback};`;
  const fn = entry.source as FunctionNode;
  if (fn.type !== 'function') return `gl_Position = ${fallback};`;
  return fn.body.statements.map((stmt) => generate(stmt)).join('\n  ');
};

export const createFrogMaterialResult = (
  compileResult: CompileResult,
  ctx: EngineContext,
  graph: Graph
) => {
  const { compileResult: graphResult } = compileResult;

  const engineNodeIds = new Set<string>(
    graph.nodes.filter((node) => (node as CodeNode).engine).map(({ id }) => id)
  );

  const engineNode = graph.nodes.find((n) => engineNodeIds.has(n.id));

  if (!engineNode) {
    return createMaterial(compileResult, ctx);
  }

  const BaseMaterial = engineNodeTypeToConstructor(engineNode.type);

  if (!BaseMaterial) {
    return createMaterial(compileResult, ctx);
  }

  // Filter out engine node and output node sections — their GLSL comes from
  // Three.js and the output wrapper, neither of which should be injected
  const skipIds = new Set([
    graphResult.outputFrag.id,
    graphResult.outputVert.id,
  ]);
  const noSkip = (s: LineAndSource) => !skipIds.has(s.nodeId);

  // Get parsed Three.js megashader sections from engine node contexts so we
  // can dynamically strip whatever Three.js actually declares in this compile.
  // Must use compileResult.updatedNodeContext (not ctx.nodes) since the engine
  // node's megashader AST is computed during this compilation pass.
  const { updatedNodeContext } = compileResult;
  const engineNodes = Array.from(engineNodeIds).map(
    (id) => graph.nodes.find((n) => n.id === id) as CodeNode
  );
  const threeFragSections = (() => {
    const fragNode = engineNodes.find((n) => n?.stage === 'fragment');
    const ast = fragNode
      ? (updatedNodeContext[fragNode.id]?.ast as Program)
      : null;
    return ast?.program?.length
      ? findShaderSections('three', ast)
      : shaderSectionsCons();
  })();
  const threeVertSections = (() => {
    const vertNode = engineNodes.find((n) => n?.stage === 'vertex');
    const ast = vertNode
      ? (updatedNodeContext[vertNode.id]?.ast as Program)
      : null;
    return ast?.program?.length
      ? findShaderSections('three', ast)
      : shaderSectionsCons();
  })();

  const fragmentShader = generate(
    shaderSectionsToProgram(
      stripThreeDeclarations(
        filterSections(noSkip, graphResult.fragment),
        // graphResult.fragment,
        threeFragSections
      ),
      frogMergeOptions
    ).program
  );
  const vertexShader = generate(
    shaderSectionsToProgram(
      stripThreeDeclarations(
        filterSections(noSkip, graphResult.vertex),
        // graphResult.vertex,
        threeVertSections
      ),
      frogMergeOptions
    ).program
  );

  // Extract the final output expressions from the output nodes' compiled AST.
  // This handles both code nodes (frogFragOut = main_NodeName()) and expression
  // nodes like add (frogFragOut = inlined_expr) without guessing the function name.
  const fragmentOutput = extractOutputExpr(
    graphResult.fragment,
    graphResult.outputFrag.id,
    'frogFragOut',
    'vec4(1.0)'
  );
  const vertexOutput = extractVertexMainStmts(
    graphResult.vertex,
    graphResult.outputVert.id,
    'vec4(1.0)'
  );

  const uniforms: Record<string, { value: any }> = {
    time: { value: 0 },
    cameraPosition: { value: new Vector3(1.0) },
    renderResolution: { value: new Vector2(1.0) },
  };

  let fragmentInjections: ShaderInjection[] = [];
  let vertexInjections: ShaderInjection[] = [];

  const additionalProperties = Object.entries(
    compileResult.compileResult.engineNodeProperties
  ).reduce<Record<string, any>>((acc, [name, property]) => {
    if (
      property.fillerGroup.filler
        .toString()
        .includes('strategy_type_assignmentTo')
    ) {
      fragmentInjections.push({
        search: new RegExp(`(${name} = ).+;`),
        replace: `$1${property.result.toString()};`,
      });
      vertexInjections.push({
        search: new RegExp(`(${name} = ).+;`),
        replace: `$1${property.result.toString()};`,
      });
    } else {
      acc[name] = property.result;
    }
    return acc;
  }, {});

  const mat = new FrogMaterial({
    baseMaterial: BaseMaterial as any,
    materialName: engineNodeTypeToConstructorName(engineNode.type) ?? undefined,
    fragmentShader,
    fragmentOutput,
    vertexShader,
    vertexOutput,
    uniforms,
    fragmentInjections,
    vertexInjections,
    ...additionalProperties,
  });

  // Three has switched to vMapUv / vNormalMapUv / vBumpMapUv etc. Most legacy
  // ShaderFrog shaders depend on uv.
  const m = mat as any;
  m.defines = m.defines ?? {};
  m.defines.USE_UV = '';
  m.defines.USE_UV2 = '';
  m.defines.USE_TANGENT = '';

  return mat;
};

export const engineNodeTypeToConstructorName = (
  type: string
): 'MeshPhongMaterial' | 'MeshPhysicalMaterial' | 'MeshToonMaterial' | null => {
  if (type === EngineNodeType.physical) return 'MeshPhysicalMaterial';
  if (type === EngineNodeType.phong) return 'MeshPhongMaterial';
  if (type === EngineNodeType.toon) return 'MeshToonMaterial';
  return null;
};

export type FrogMaterialExport = {
  fragmentShader: string;
  vertexShader: string;
  fragmentOutput: string;
  vertexOutput: string;
  baseMaterialType:
    | 'MeshPhongMaterial'
    | 'MeshPhysicalMaterial'
    | 'MeshToonMaterial';
  // Properties passed as-is to FrogMaterial (map, normalMap, etc. as GLSL strings)
  injectableProps: Record<string, string>;
  // Injections that replace assignment patterns in Three's compiled shader
  fragmentInjections: ShaderInjection[];
  vertexInjections: ShaderInjection[];
};

export const prepareFrogMaterialExport = (
  compileResult: CompileResult,
  graph: Graph
): FrogMaterialExport | null => {
  const { compileResult: graphResult } = compileResult;

  const engineNodeIds = new Set<string>(
    graph.nodes.filter((node) => (node as CodeNode).engine).map(({ id }) => id)
  );
  const engineNode = graph.nodes.find((n) => engineNodeIds.has(n.id));

  if (!engineNode) return null;

  const baseMaterialType = engineNodeTypeToConstructorName(engineNode.type);
  if (!baseMaterialType) return null;

  const skipIds = new Set([
    graphResult.outputFrag.id,
    graphResult.outputVert.id,
  ]);
  const noSkip = (s: LineAndSource) => !skipIds.has(s.nodeId);

  const { updatedNodeContext } = compileResult;
  const engineNodes = Array.from(engineNodeIds).map(
    (id) => graph.nodes.find((n) => n.id === id) as CodeNode
  );

  const threeFragSections = (() => {
    const fragNode = engineNodes.find((n) => n?.stage === 'fragment');
    const ast = fragNode
      ? (updatedNodeContext[fragNode.id]?.ast as Program)
      : null;
    return ast?.program?.length
      ? findShaderSections('three', ast)
      : shaderSectionsCons();
  })();

  const threeVertSections = (() => {
    const vertNode = engineNodes.find((n) => n?.stage === 'vertex');
    const ast = vertNode
      ? (updatedNodeContext[vertNode.id]?.ast as Program)
      : null;
    return ast?.program?.length
      ? findShaderSections('three', ast)
      : shaderSectionsCons();
  })();

  const fragmentShader = generate(
    shaderSectionsToProgram(
      stripThreeDeclarations(
        filterSections(noSkip, graphResult.fragment),
        threeFragSections
      ),
      frogMergeOptions
    ).program
  );

  const vertexShader = generate(
    shaderSectionsToProgram(
      stripThreeDeclarations(
        filterSections(noSkip, graphResult.vertex),
        threeVertSections
      ),
      frogMergeOptions
    ).program
  );

  const fragmentOutput = extractOutputExpr(
    graphResult.fragment,
    graphResult.outputFrag.id,
    'frogFragOut',
    'vec4(1.0)'
  );

  const vertexOutput = extractVertexMainStmts(
    graphResult.vertex,
    graphResult.outputVert.id,
    'vec4(1.0)'
  );

  // Mirror the same split createFrogMaterialResult does
  const fragmentInjections: ShaderInjection[] = [];
  const vertexInjections: ShaderInjection[] = [];
  const injectableProps: Record<string, string> = {};

  Object.entries(graphResult.engineNodeProperties).forEach(([name, prop]) => {
    if (!prop.result) return;
    if (
      prop.fillerGroup.filler.toString().includes('strategy_type_assignmentTo')
    ) {
      const replace = `$1${prop.result};`;
      fragmentInjections.push({ search: `(${name} = ).+;`, replace });
      vertexInjections.push({ search: `(${name} = ).+;`, replace });
    } else {
      injectableProps[name] = prop.result;
    }
  });

  return {
    fragmentShader,
    vertexShader,
    fragmentOutput,
    vertexOutput,
    baseMaterialType,
    injectableProps,
    fragmentInjections,
    vertexInjections,
  };
};
