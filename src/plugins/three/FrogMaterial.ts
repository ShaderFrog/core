import * as THREE from 'three';

// ── Shader transformation utilities ──────────────────────────────────────────

export const expandChunks = (glsl: string, depth = 0): string => {
  if (depth > 12) return glsl;
  return glsl.replace(/#include <(\w+)>/g, (_, chunkName: string) => {
    const chunk = (THREE.ShaderChunk as Record<string, string>)[chunkName];
    if (chunk !== undefined) {
      return `/* ~~~ #include <${chunkName}> ~~~ */\n${expandChunks(
        chunk,
        depth + 1
      )}\n/* ~~~ end <${chunkName}> ~~~ */`;
    }
    return `/* MISSING #include <${chunkName}> */`;
  });
};

export const replaceFromOffset = (
  str: string,
  offset: number,
  search: string | RegExp,
  replacement: string
) => str.slice(0, offset) + str.slice(offset).replace(search, replacement);

export const replaceLast = (
  str: string,
  charToReplace: string,
  replacement: string
) => {
  const index = str.lastIndexOf(charToReplace);
  if (index === -1) return str;
  return (
    str.slice(0, index) + replacement + str.slice(index + charToReplace.length)
  );
};

// ── Injectable fragment properties ───────────────────────────────────────────
// When a material property value is a string, it's treated as a GLSL call
// expression and injected at the corresponding point in the expanded shader.
// A dummy Texture is set on the material to force Three.js to emit the chunk.
//
// InjectableKey covers every texture-typed property from threngine. Only those
// listed in FRAGMENT_INJECTABLE have a known injection pattern; the rest accept
// strings in the TypeScript type but produce no automatic shader replacement
// (the caller can still handle them via fragmentInjections).

type FragmentInjectionPoint = {
  find: RegExp;
  replace: (callExpr: string) => string;
  forceProperty: string;
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
  | 'gradientMap';

const INJECTABLE_KEYS: ReadonlySet<string> = new Set<InjectableKey>([
  'map', 'normalMap', 'aoMap', 'emissiveMap', 'roughnessMap',
  'specularMap', 'displacementMap', 'bumpMap', 'transmissionMap', 'gradientMap',
]);

// Injection implementations for the properties where we know the pattern
const FRAGMENT_INJECTABLE: Partial<Record<InjectableKey, FragmentInjectionPoint>> = {
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
};

// For injectable properties, also allow a GLSL expression string
type WithInjectables<P> = {
  [K in keyof P]: K extends InjectableKey ? P[K] | string : P[K];
};

// ── Vertex position injection ─────────────────────────────────────────────────

const POSITION_INJECTION = {
  find: /vec3 transformed = vec3\( position \);/,
  replace: (call: string) => `vec3 transformed = ${call}.xyz;`,
};

// ── FrogMaterial ──────────────────────────────────────────────────────────────

interface ShaderInjection {
  search: string;
  replace: string;
}

type MaterialConstructor = new (...args: any[]) => THREE.Material;

type ConstructorParams<C extends MaterialConstructor> = C extends new (
  params?: infer P,
  ...args: any[]
) => THREE.Material
  ? NonNullable<P>
  : never;

type FrogSpecificKeys =
  | 'baseMaterial'
  | 'fragmentShader'
  | 'fragmentOutput'
  | 'vertexShader'
  | 'vertexOutput'
  | 'uniforms'
  | 'fragmentInjections'
  | 'position'
  | 'onBeforeCompile';

export type FrogMaterialParams<
  C extends MaterialConstructor = MaterialConstructor
> = {
  baseMaterial: C;
  fragmentShader: string;
  fragmentOutput: string;
  vertexShader: string;
  vertexOutput: string;
  uniforms?: Record<string, THREE.IUniform>;
  fragmentInjections?: ShaderInjection[];
  /** GLSL expression replacing `vec3 transformed = vec3(position)` */
  position?: string;
  /** Called after all frog transforms are applied to the shader */
  onBeforeCompile?: (
    shader: THREE.WebGLProgramParametersWithUniforms,
    renderer: THREE.WebGLRenderer
  ) => void;
} & Omit<WithInjectables<ConstructorParams<C>>, FrogSpecificKeys>;

function _create<C extends MaterialConstructor>({
  baseMaterial: BaseMaterial,
  fragmentShader,
  fragmentOutput,
  vertexShader,
  vertexOutput,
  uniforms = {},
  fragmentInjections = [],
  position,
  onBeforeCompile: userOnBeforeCompile,
  ...baseProps
}: FrogMaterialParams<C>): THREE.Material {
  // Split baseProps: injectable strings become GLSL injections + dummy textures
  const glslInjections: Array<{ find: RegExp; replace: string }> = [];
  const materialProps: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(
    baseProps as Record<string, unknown>
  )) {
    if (INJECTABLE_KEYS.has(key) && typeof value === 'string') {
      const inj = FRAGMENT_INJECTABLE[key as InjectableKey];
      if (inj) {
        glslInjections.push({ find: inj.find, replace: inj.replace(value) });
        materialProps[inj.forceProperty] = new THREE.Texture();
      } else {
        materialProps[key] = new THREE.Texture();
      }
    } else {
      materialProps[key] = value;
    }
  }

  const mat = new BaseMaterial(materialProps as ConstructorParams<C>);

  mat.onBeforeCompile = (shader, renderer) => {
    Object.assign(shader.uniforms, uniforms);
    mat.userData.shader = shader;

    // ── Fragment ──────────────────────────────────────────────────────────
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
        fragmentShader +
          '\n\nvec4 main_MeshPhysicalMaterial() {\n    vec4 fragColor = vec4(0.0);'
      ) + `\n\nvoid main() { gl_FragColor = ${fragmentOutput}; }`;

    for (const { find, replace } of glslInjections) {
      shader.fragmentShader = shader.fragmentShader.replace(find, replace);
    }
    for (const { search, replace } of fragmentInjections) {
      shader.fragmentShader = shader.fragmentShader.replace(search, replace);
    }

    // ── Vertex ────────────────────────────────────────────────────────────
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
        vertexShader +
          '\n\nvec4 main_MeshPhysicalMaterial() {\n    vec4 fragPosition = vec4(0.0);'
      ) + `\n\nvoid main() { ${vertexOutput} }`;

    if (position) {
      shader.vertexShader = shader.vertexShader.replace(
        POSITION_INJECTION.find,
        POSITION_INJECTION.replace(position)
      );
    }

    userOnBeforeCompile?.(shader, renderer);
  };

  return mat;
}

// Interface merge: TypeScript sees FrogMaterial as extending THREE.Material,
// so instances can be used wherever THREE.Material is expected.
export interface FrogMaterial<
  C extends MaterialConstructor = MaterialConstructor
> extends THREE.Material {}
export class FrogMaterial<C extends MaterialConstructor = MaterialConstructor> {
  constructor(params: FrogMaterialParams<C>) {
    return _create(params) as unknown as FrogMaterial<C>;
  }
}
