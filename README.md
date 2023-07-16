# Shaderfrog Core

🚨 This library is experimental! 🚨
🚨 The API can change at any time! 🚨

The core graph API that powers Shaderfrog. This API, built on top of the
[@Shaderfrog/glsl-parser](https://github.com/ShaderFrog/glsl-parser), compiles
Shaderfrog graphs into an intermediate result, which you then pass off to an
_engine_ (aka a plugin), to create a running GLSL shader.

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

Each fillable part of the AST is called a __hole__. Holes are found by executing
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

This whle process allows Shaderfrog to monkeypatch engine shaders. When
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
