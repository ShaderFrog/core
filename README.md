# Shaderfrog Core

ShaderFrog Core is the core library that powers [Shaderfrog.com](https://shaderfrog.com/). You're proably here for exported materials from Shaderfrog using `FrogMaterial`.

# FrogMaterial: Three.js Material Export 

`FrogMaterial` creates an extensible Three.js material with a high degree of control over the source code, making Three.js materials more customizable than the standard path using [onBeforeCompile](https://threejs.org/docs/#Material.onBeforeCompile).

Usage example: 

```ts
import { MesHPhysicalMaterial } from 'three';
import { FrogMaterial } from '@shaderfrog/core/plugins/three';

const material = new FrogMaterial({
    baseMaterial: MeshPhysicalMaterial,
    materialName: 'MeshPhysicalMaterial',
    fragmentShader,
    fragmentOutput: "(main_Edge_Glow()+ main_MeshPhysicalMaterial())",
    vertexShader,
    vertexOutput: "main_Parallax();\n\n    \n  main_Edge_Glow();\n\n    \n  main_Striped_Mandelbrot();\n\n    \n  main_Julia();\n\n    \n  gl_Position = main_MeshPhysicalMaterial();\n",
    uniforms,
    map: "main_Parallax()",
    fragmentInjections: [{
      search: new RegExp("(normal = ).+;"), replace: "$1(vNormal + sampledDiffuseColor.rgb * 0.5);"
    }],
    vertexInjections: [{
      search: new RegExp("(normal = ).+;"), replace: "$1(vNormal + sampledDiffuseColor.rgb * 0.5);"
    }],
    metalness: 0,
    roughness: 0.065,
});
```

The FrogMaterial API:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `baseMaterial` | Three.js material constructor, e.g. `MeshPhysicalMaterial` | Yes | The Three.js material class to extend. `FrogMaterial` constructs an instance of this class and drives its `onBeforeCompile`. |
| `materialName` | `string` | No | Stable name used as the GLSL engine function prefix (e.g. `'MeshPhysicalMaterial'`). Falls back to `baseMaterial.name`, but that's mangled by minifiers, so set this explicitly in production bundles. |
| `fragmentShader` | `string` | Yes | GLSL source injected above `main()` in the fragment shader. Must declare a `main_<materialName>()`-style function per `fragmentOutput`/injections below. |
| `fragmentOutput` | `string` | Yes | GLSL expression assigned to `gl_FragColor` in the generated `main()`, e.g. `"(main_Edge_Glow() + main_MeshPhysicalMaterial())"`. |
| `vertexShader` | `string` | Yes | GLSL source injected above `main()` in the vertex shader, mirroring `fragmentShader`. |
| `vertexOutput` | `string` | Yes | Statement(s) run inside the generated vertex `main()`; should end by assigning `gl_Position`. |
| `uniforms` | `Record<string, IUniform>` | No | Custom uniforms merged into `shader.uniforms` in `onBeforeCompile`. |
| `fragmentInjections` | `ShaderInjection[]` | No | Raw `{ search, replace }` patches applied to the final fragment shader source, after chunk expansion and output wiring. |
| `vertexInjections` | `ShaderInjection[]` | No | Same as `fragmentInjections`, applied to the final vertex shader source. |
| `onBeforeCompile` | `(shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void` | No | Called last, after all FrogMaterial transforms are applied to the shader. |
| *texture-injectable keys* (`map`, `normalMap`, `aoMap`, `emissiveMap`, `roughnessMap`, `specularMap`, `displacementMap`, `bumpMap`, `transmissionMap`, `gradientMap`, `thickness`, `transmission`, `position`) | `string \| Texture` | No | Any of `baseMaterial`'s own texture/property fields. Pass a `Texture` for normal Three.js behavior, or a GLSL expression string (e.g. `"main_Parallax()"`) to wire a generated function's output into that slot instead. |
| *(remaining fields)* | Whatever `baseMaterial`'s constructor accepts (e.g. `metalness`, `roughness`, `color`) | No | Any other property `baseMaterial`'s constructor takes is passed straight through, e.g. `metalness: 0, roughness: 0.065`. |

#### `uniforms`

Merged directly into the compiled shader's uniforms, using the same shape Three.js uniforms use:

```ts
uniforms: {
  time: { value: 0 },
  resolution: { value: new Vector2(1, 1) },
}
```

#### `fragmentInjections` / `vertexInjections`

Each entry is a `{ search: string | RegExp, replace: string }` pair applied via `shader.replace(search, replace)` against the fully assembled shader source, after chunk expansion and after `fragmentOutput`/`vertexOutput` wiring — use these for edits that can't be expressed as a plain injectable property:

```ts
fragmentInjections: [
  {
    search: new RegExp('(normal = ).+;'),
    replace: '$1(vNormal + sampledDiffuseColor.rgb * 0.5);',
  },
],
```

#### `onBeforeCompile`

Runs after FrogMaterial's own `onBeforeCompile` logic, so `shader.fragmentShader`/`shader.vertexShader` already reflect every injection above:

```ts
onBeforeCompile: (shader, renderer) => {
  shader.uniforms.time.value = performance.now() / 1000;
},
```

# Core Shaderfrog Graph API

🚨 This Core Graph API is experimental and can change at any time! 🚨

The core graph API that powers Shaderfrog. This API, built on top of the
[@Shaderfrog/glsl-parser](https://github.com/ShaderFrog/glsl-parser), compiles
Shaderfrog graphs into an intermediate result, which you then pass off to an
_engine_ (aka a plugin), to create a running GLSL shader.

### Examples

See examples of using Core in your own projects [on Github](https://github.com/ShaderFrog/examples).

- **Three.js:** [Live](https://codesandbox.io/s/great-hertz-sjh425?file=/src/index.js) - [Source](https://github.com/ShaderFrog/examples/tree/main/three)

### Graph

```typescript
interface Graph {
  nodes: GraphNode[];
  edges: Edge[];
}
```

The Shaderfrog _graph_ is a list of nodes and edges. It represents all of the
GLSL code and configurations in your material. Conceptually, a graph is similar
to a dependency graph for source code, where edges represent relationships
(including dependencies) between nodes.

Each _node_ in the graph is some type of GLSL (raw source code) and configuration.
Some graph node GLSL is hard coded, as in written by you, like in a
`SourceNode`. Some source code is generated at runtime by an engine, and
injected into a node right before the graph is compiled.

Each _edge_ in the graph represents a dependency between two nodes. Edges have
different types and meanings, based on which inputs and outputs they're
connected to.

The main API function for working with graphs are `compileGraph` and
`computeGraphContext`:

```typescript
type compileGraph = (
  engineContext: EngineContext,
  engine: Engine,
  graph: Graph
): CompileGraphResult

type computeGraphContext = async (
  engineContext: EngineContext,
  engine: Engine,
  graph: Graph
): void
```

A graph's _context_, more specifically a node's context, is the runtime /
in-memory computed data associated with a graph node. It includes the parsed AST
representation of the node, as well as the inputs found in that AST.

### Parsers

A graph is a vanilla Javscript object. To convert it to context, there's one
"parser" per node type in the graph, defined in the engine configuration. A
parser is an object with this interface:

```typescript
type NodeParser = {
  // cacheKey?: (graph: Graph, node: GraphNode, sibling?: GraphNode) => string;
  // Callback hook to manipulate the node right before it's compiled by the
  // graph. Engines use this to dynamically generate node source code.
  onBeforeCompile?: OnBeforeCompile;
  // Callback hook to manipulate the parsed AST. Example use is to convert
  // standalone GLSL programs into code that can be used in the graph, like
  // turning `void main() { out = color; }` into `vec4 main() { return color; }`
  manipulateAst?: ManipulateAst;
  // Find the inputs for this node type. Done dynamically because it's based on
  // the source code of the node.
  findInputs?: FindInputs;
  // Create the filler AST offered up to nodes that import this node.
  produceFiller?: ProduceNodeFiller;
};
```

### Engine

Shaderfrog is a GLSL editor. It's not a Three.js editor, nor a Babylon.js
editor, etc. The output of Shaderfrog is raw GLSL and metadata.

To use shaders in your _engine_, like Three.js, or even your own home grown
engine, you implement your engine as a _plugin_ to Shaderfrog. An engine
definition is verbose and likely to change:

```typescript
export interface Engine {
  // The name of your engine, like "three"
  name: string;
  // Which GLSL variables are defined in your engine's materials
  preserve: Set<string>;
  // Rules for how to merge source code from different nodes together
  mergeOptions: MergeOptions;
  // Parsers for your engine node types. These are combined with the
  // core engine parsers
  parsers: Record<string, NodeParser>;
  // Functions to import graphs/code from other engines into your own
  importers: EngineImporters;
  // How to evaluate a node, like turning a node of { type: 'vec3' } into a
  // THREE.Vector3
  evaluateNode: (node: DataNode) => any;
  // How to create specific nodes in your engine
  constructors: {
    [EngineNodeType]: NodeConstructor;
  };
}
```

### Inputs, Holes and Fillers

Shaderfrog works by searching each node's AST for certain patterns, like
`uniform` variables, and creating an interface where you can replace each
`uniform` variable with the output of another node.

Each fillable part of the AST is called a **hole**. Holes are found by executing
user defined _strategies_ against an AST. With a program such as:

```glsl
uniform vec2 uv;
void main() {
  vec2 someVar = uv * 2.0;
}
```

If you apply the `uniform` strategy to this code, it will mark the AST nodes
relevant to the uniform as _holes_:

```glsl
uniform vec2 [uv];
void main() {
  vec2 someVar = [uv] * 2.0;
}
```

And it adds a new _input_ to your node, named `uv` in this case.

When you plug in the output of another node into this input, it _"fills in"_ the
hole with the _filler_ output of another node. A _filler_ is an AST node. For
example, if you have another node like:

```glsl
vec2 myFn() {
  return vec2(1.0, 1.0);
}
```

And you plug in the `myFn` output into the `uv` input, the hole is _filled_,
resulting in:

```glsl
vec2 myFn() {
  return vec2(1.0, 1.0);
}

void main() {
  vec2 someVar = myFn() * 2.0;
}
```

Note that this is not a simple find and replace. Not only was the `uv` variable
replaced, but the declaration line `uniform vec2 uv;` was removed, and `myFn`
was inlined into the final program.

Hole filling always produces a new AST, or more accurately, a new
`ShaderSections`, which is the intermediary representation of the compilation
process.

### Static Monkeypatching

This whole process allows Shaderfrog to monkeypatch engine shaders. When
modifying an engine shader, the process is:

- Shaderfrog creates a `BABYLON.PBRMaterial` or `Three.MeshPhysicalMaterial` (or
  whatever built in material type you want)
- Shaderfrog reads the engine material's generated GLSL, and then modifies it to
  add new effects by injecting new GLSL
- Shaderfrog dumps the new compiled GLSL back into the `BABYLON.PBRMaterial` or
  `Three.MeshPhysicalMaterial`, and updates the material to add a new uniforms.

Injecting new GLSL into an engine shader is essentially _monkeypatching_ it:
your code is modifying an external library's code. I call this _static
monkeypatching_ because compiles new source code. This is opposed to traditional
monkeypatching in languages like Ruby, where you modify external modules by
changing them at runtime.
