import { replaceFromOffset, replaceLast } from '../../util/string';
import {
  IUniform,
  WebGLProgramParametersWithUniforms,
  WebGLRenderer,
  Material,
  Texture,
  ShaderChunk,
} from 'three';

// Expand Three.js Chunks
export const expandChunks = (glsl: string, depth = 0): string => {
  if (depth > 12) return glsl;
  return glsl.replace(/#include <(\w+)>/g, (_, chunkName: string) => {
    const chunk = (ShaderChunk as Record<string, string>)[chunkName];
    if (chunk !== undefined) {
      return `/* ~~~ #include <${chunkName}> ~~~ */\n${expandChunks(
        chunk,
        depth + 1
      )}\n/* ~~~ end <${chunkName}> ~~~ */`;
    }
    return `/* MISSING #include <${chunkName}> */`;
  });
};

export type InjectionPoint = {
  find: RegExp;
  replace: (callExpr: string) => string;
  forceProperty?: string;
};

// All texture-typed property names across phong / physical / toon in threngine
type InjectableKey =
  | 'map'
  | 'normalMap'
  | 'aoMap'
  | 'emissiveMap'
  | 'roughnessMap'
  | 'specularMap'
  | 'displacementMap'
  | 'bumpMap'
  | 'transmissionMap'
  | 'gradientMap'
  | 'thickness'
  | 'transmission'
  | 'position';

const INJECTABLE_KEYS: ReadonlySet<string> = new Set<InjectableKey>([
  'map',
  'normalMap',
  'aoMap',
  'emissiveMap',
  'roughnessMap',
  'specularMap',
  'displacementMap',
  'bumpMap',
  'transmissionMap',
  'gradientMap',
  'thickness',
  'transmission',
  'position',
]);

// FrogMaterial properties that replace Three.js geenrated code
const FRAGMENT_INJECTABLE: Partial<Record<InjectableKey, InjectionPoint>> = {
  map: {
    find: /vec4 sampledDiffuseColor = [^;]+;/,
    replace: (call: string) => `vec4 sampledDiffuseColor = ${call};`,
    forceProperty: 'map',
  },
  normalMap: {
    find: /vec3 mapN = texture2D\( normalMap, vNormalMapUv \)\.xyz \* 2\.0 - 1\.0;/,
    replace: (call: string) => `vec3 mapN = ${call}.rgb * 2.0 - 1.0;`,
    forceProperty: 'normalMap',
  },
  emissiveMap: {
    find: /vec4 emissiveColor = [^;]+;/,
    replace: (call: string) => `vec4 emissiveColor = ${call};`,
    forceProperty: 'emissiveMap',
  },
  roughnessMap: {
    find: /vec4 texelRoughness = [^;]+;/,
    replace: (call: string) => `vec4 texelRoughness = ${call};`,
    forceProperty: 'roughnessMap',
  },
  aoMap: {
    find: /float ambientOcclusion = [^;]+;/,
    replace: (call: string) =>
      `float ambientOcclusion = ( ${call}.r - 1.0 ) * aoMapIntensity + 1.0;`,
    forceProperty: 'aoMap',
  },
  specularMap: {
    find: /vec4 texelSpecular = [^;]+;/,
    replace: (call: string) => `vec4 texelSpecular = ${call};`,
    forceProperty: 'specularMap',
  },
  thickness: {
    find: /material.thickness = [^;]+;/,
    replace: (call: string) => `material.thickness = ${call};`,
    forceProperty: 'thickness',
  },
  transmission: {
    find: /material.transmission = [^;]+;/,
    replace: (call: string) => `material.transmission = ${call};`,
    forceProperty: 'transmission',
  },
};

const VERTEX_INJECTABLES: Partial<Record<InjectableKey, InjectionPoint>> = {
  position: {
    find: /vec3 transformed = vec3\( position \);/,
    replace: (call: string) => `vec3 transformed = ${call}.xyz;`,
  },
  displacementMap: {
    find: /texture2D\( displacementMap, vDisplacementMapUv \)/,
    replace: (call: string) => call,
    forceProperty: 'displacementMap',
  },
};

// For injectable properties, also allow a GLSL expression string
type WithInjectables<P> = {
  [K in keyof P]: K extends InjectableKey ? P[K] | string : P[K];
};

export interface ShaderInjection {
  search: string | RegExp;
  replace: string;
}

type MaterialConstructor = new (...args: any[]) => Material;

type ConstructorParams<C extends MaterialConstructor> = C extends new (
  params?: infer P,
  ...args: any[]
) => Material
  ? NonNullable<P>
  : never;

type FrogSpecificKeys =
  | 'baseMaterial'
  | 'materialName'
  | 'fragmentShader'
  | 'fragmentOutput'
  | 'vertexShader'
  | 'vertexOutput'
  | 'uniforms'
  | 'fragmentInjections'
  | 'vertexInjections'
  | 'onBeforeCompile';

export type FrogMaterialParams<
  C extends MaterialConstructor = MaterialConstructor
> = {
  baseMaterial: C;
  /** Stable name used as the GLSL engine function prefix (e.g. 'MeshPhysicalMaterial').
   *  Required in minified/production bundles where Function.name is mangled. */
  materialName?: string;
  fragmentShader: string;
  fragmentOutput: string;
  vertexShader: string;
  vertexOutput: string;
  uniforms?: Record<string, IUniform>;
  fragmentInjections?: ShaderInjection[];
  vertexInjections?: ShaderInjection[];
  /** Called after all frog transforms are applied to the shader */
  onBeforeCompile?: (
    shader: WebGLProgramParametersWithUniforms,
    renderer: WebGLRenderer
  ) => void;
} & Omit<WithInjectables<ConstructorParams<C>>, FrogSpecificKeys> &
  Partial<Record<InjectableKey, string>>;

function _create<C extends MaterialConstructor>({
  baseMaterial: BaseMaterial,
  materialName,
  fragmentShader,
  fragmentOutput,
  vertexShader,
  vertexOutput,
  uniforms = {},
  fragmentInjections = [],
  vertexInjections = [],
  onBeforeCompile: userOnBeforeCompile,
  ...baseProps
}: FrogMaterialParams<C>): Material {
  // Split baseProps: injectable strings become GLSL injections + dummy textures
  const glslInjections: ShaderInjection[] = [];
  const materialProps: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(
    baseProps as Record<string, unknown>
  )) {
    if (INJECTABLE_KEYS.has(key) && typeof value === 'string') {
      const inj =
        FRAGMENT_INJECTABLE[key as InjectableKey] ||
        VERTEX_INJECTABLES[key as InjectableKey];
      if (inj) {
        glslInjections.push({ search: inj.find, replace: inj.replace(value) });
        if (inj.forceProperty) {
          materialProps[inj.forceProperty] = new Texture();
        }
      } else {
        materialProps[key] = new Texture();
      }
    } else {
      materialProps[key] = value;
    }
  }

  const mat = new BaseMaterial(materialProps as ConstructorParams<C>);
  const engineFnName = `main_${
    materialName || BaseMaterial.name || 'BaseMaterial'
  }`;

  mat.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, uniforms);
    mat.userData.shader = shader;

    shader.fragmentShader = expandChunks(shader.fragmentShader);

    shader.fragmentShader = replaceFromOffset(
      shader.fragmentShader,
      shader.fragmentShader.indexOf('void main'),
      /gl_FragColor/g,
      'fragColor'
    );
    shader.fragmentShader = replaceLast(
      shader.fragmentShader,
      '}',
      'return fragColor;\n}'
    );

    shader.fragmentShader =
      shader.fragmentShader.replace(
        'void main() {',
        `vec4 ${engineFnName}();\n` +
          fragmentShader +
          `\n\nvec4 ${engineFnName}() {\n    vec4 fragColor = vec4(0.0);`
      ) +
      `

void main() {${
        // HACK: Need to update compiled shader generator to assign here
        fragmentOutput.includes('gl_FragColor')
          ? fragmentOutput
          : `  gl_FragColor = ${fragmentOutput};`
      }
}`;

    for (const { search, replace } of glslInjections) {
      shader.fragmentShader = shader.fragmentShader.replace(search, replace);
    }

    for (const { search, replace } of fragmentInjections) {
      shader.fragmentShader = shader.fragmentShader.replace(search, replace);
    }

    shader.vertexShader = expandChunks(shader.vertexShader);

    shader.vertexShader = replaceFromOffset(
      shader.vertexShader,
      shader.vertexShader.indexOf('void main'),
      'gl_Position',
      'fragPosition'
    );
    shader.vertexShader = replaceLast(
      shader.vertexShader,
      '}',
      'return fragPosition;\n}'
    );

    shader.vertexShader =
      shader.vertexShader.replace(
        'void main() {',
        `vec4 ${engineFnName}();\n` +
          vertexShader +
          `\n\nvec4 ${engineFnName}() {\n    vec4 fragPosition = vec4(0.0);`
      ) + `\n\nvoid main() { ${vertexOutput} }`;

    for (const { search, replace } of glslInjections) {
      shader.vertexShader = shader.vertexShader.replace(search, replace);
    }

    for (const { search, replace } of vertexInjections) {
      shader.vertexShader = shader.vertexShader.replace(search, replace);
    }

    userOnBeforeCompile?.(shader, renderer);
  };

  mat.customProgramCacheKey = () =>
    fragmentShader +
    '\x00' +
    fragmentOutput +
    '\x00' +
    vertexShader +
    '\x00' +
    vertexOutput +
    '\x00' +
    JSON.stringify(fragmentInjections) +
    '\x00' +
    JSON.stringify(vertexInjections);

  return mat;
}

// Interface merge: TypeScript sees FrogMaterial as extending THREE.Material,
// so instances can be used wherever THREE.Material is expected.
export interface FrogMaterial<
  C extends MaterialConstructor = MaterialConstructor
> extends Material {}
export class FrogMaterial<C extends MaterialConstructor = MaterialConstructor> {
  constructor(params: FrogMaterialParams<C>) {
    return _create(params) as unknown as FrogMaterial<C>;
  }
}
