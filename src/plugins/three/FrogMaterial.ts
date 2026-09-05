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

// Three's transmission_pars_fragment chunk declares its own `uniform mat4
// modelMatrix;`, gated behind `#ifdef USE_TRANSMISSION` — the only Three
// fragment chunk that redeclares a matrix the vertex prefix already gets for
// free. That chunk is included unconditionally in the physical fragment
// template, so expandChunks above always inlines the declaration as literal
// text; the #ifdef is only evaluated later, by the GPU compiler. A compiled
// shader graph that needs modelMatrix in its own fragment code (e.g. a
// world-position/reflection node) has to declare it explicitly too, since
// fragment doesn't get it unconditionally like vertex does. When the
// material's transmission uniform is actually > 0, both declarations become
// active and the GPU rejects the redefinition. Unlike a varying such as
// vWorldPosition, this name is load-bearing (Three binds it by exact name at
// render time), so it can't be renamed away in source — instead, drop
// Three's chunk-injected copy (which only ever matters when transmission is
// truly active, and Three's own transmission code binds the same global
// identifier regardless of which declaration survives) and keep the graph's
// own copy, which is always spliced in later in the string and so is always
// the last match.
const RESERVED_FRAGMENT_UNIFORM_REDECLARATIONS = ['modelMatrix'];

const dedupeReservedFragmentUniforms = (fragmentShader: string): string => {
  return RESERVED_FRAGMENT_UNIFORM_REDECLARATIONS.reduce((glsl, name) => {
    const re = new RegExp(`[ \\t]*uniform mat4 ${name};[ \\t]*\\r?\\n`, 'g');
    const matches = glsl.match(re);
    if (!matches || matches.length < 2) return glsl;
    let seen = 0;
    return glsl.replace(re, (match) =>
      ++seen === matches.length ? match : ''
    );
  }, fragmentShader);
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
  | 'position'
  | 'vNormal';

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
  'vNormal',
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
  // Overrides Three's own `normal_vertex` chunk output — used by composited
  // shaders (see buildComposite's vNormalProp in glsl-parse-worker.ts) that
  // need to substitute an explicit blend of two source shaders' normals
  // instead of Three's single computed `transformedNormal`.
  //
  // Also re-derives vBitangent's tangent input via Gram-Schmidt against the
  // new vNormal, instead of Three's own `cross( vNormal, vTangent )` using
  // vTangent as-is. vTangent comes from the mesh's `tangent` attribute via
  // `defaultnormal_vertex` — computed independently of vNormal and never
  // displaced — so it stays valid as long as vNormal stays close to the
  // undisplaced surface normal it was originally built alongside. A vNormal
  // substituted here can diverge arbitrarily far from that (e.g. a fully
  // Voronoi-displaced normal with no blending anchor back to the original),
  // and once it's nearly parallel to the untouched vTangent, `cross(
  // vNormal, vTangent )` collapses toward zero and `normalize()` of that
  // blows up — corrupting the whole TBN basis, and with it every
  // tangent-space-perturbed `normal` downstream (direct specular, clearcoat,
  // IBL). Projecting vTangent's component along vNormal out first keeps the
  // two vectors orthogonal by construction regardless of how far vNormal has
  // moved, so the cross product can't degenerate that way. This is a no-op
  // when vNormal is close to its original direction (dot ≈ 0 already), so
  // it's safe to always emit alongside a vNormal override.
  vNormal: {
    find: /vNormal = normalize\( transformedNormal \);\s*#ifdef USE_TANGENT\s*vTangent = normalize\( transformedTangent \);\s*vBitangent = normalize\( cross\( vNormal, vTangent \) \* tangent\.w \);\s*#endif/,
    replace: (call: string) => `vNormal = ${call};
    #ifdef USE_TANGENT
        vTangent = normalize( transformedTangent );
        vec3 vTangentOrtho = normalize( vTangent - vNormal * dot( vTangent, vNormal ) );
        vBitangent = normalize( cross( vNormal, vTangentOrtho ) * tangent.w );
    #endif`,
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

    shader.fragmentShader = dedupeReservedFragmentUniforms(shader.fragmentShader);

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
