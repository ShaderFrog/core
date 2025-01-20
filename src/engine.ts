import { Program } from '@shaderfrog/glsl-parser/ast';
import { MergeOptions } from './graph/shader-sections';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import { generate, parser } from '@shaderfrog/glsl-parser';
import { Graph, ShaderStage, GraphNode, NodeType } from './graph/graph-types';
import { NodeInput, NodePosition } from './graph/base-node';
import { DataNode, UniformDataType } from './graph/data-nodes';
import { CodeNode, NodeProperty, SourceNode } from './graph/code-nodes';
import { Edge } from './graph/edge';
import groupBy from 'lodash.groupby';
import { NodeContext, NodeContexts } from './graph/context';
import { NodeParser } from './graph/parsers';
import { collectNodeProperties } from './graph/graph';
import { evaluateNode } from './graph/evaluate';

const log = (...args: any[]) =>
  console.log.call(console, '\x1b[32m(core)\x1b[0m', ...args);

export enum EngineNodeType {
  toon = 'toon',
  phong = 'phong',
  physical = 'physical',
  shader = 'shader',
  binary = 'binary',
}

// This sucks, why did I do it this way? Seems like there should just be a
// default engine node constuctor type
export type PhongNodeConstructor = (
  id: string,
  name: string,
  position: NodePosition,
  uniforms: UniformDataType[],
  stage: ShaderStage | undefined
) => CodeNode;

export type PhysicalNodeConstructor = (
  id: string,
  name: string,
  position: NodePosition,
  uniforms: UniformDataType[],
  stage: ShaderStage | undefined
) => CodeNode;

export type ToonNodeConstructor = (
  id: string,
  name: string,
  position: NodePosition,
  uniforms: UniformDataType[],
  stage: ShaderStage | undefined
) => CodeNode;

export interface Engine {
  name: 'three' | 'babylon' | 'playcanvas';
  displayName: string;
  preserve: Set<string>;
  mergeOptions: MergeOptions;
  // Component: FunctionComponent<{ engine: Engine; parsers: NodeParsers }>;
  // nodes: NodeParsers;
  parsers: Record<string, NodeParser>;
  importers: EngineImporters;
  evaluateNode: (node: DataNode) => any;
  constructors: {
    [EngineNodeType.phong]?: PhongNodeConstructor;
    [EngineNodeType.physical]?: PhysicalNodeConstructor;
    [EngineNodeType.toon]?: ToonNodeConstructor;
  };
}

// I commented this out because I don't know if I still need to duplicate it
// here, and why I did that in the first place, or if I can just use the core
// graph NodeContext type, which I am now
//
// Note this has to match what's in context.ts which also has a defintion of
// NodeContext. TODO: Dry this up
// export type NodeContext = {
//   ast: AstNode | Program;
//   source?: string;
//   // Inputs are determined at parse time and should probably be in the graph,
//   // not here on the runtime context for the node
//   inputs?: NodeInput[];
//   name?: string;
//   id?: string;
//   errors?: any;
// };

// The context an engine builds as it evaluates. It can manage its own state
// as the generic "RuntimeContext" which is passed to implemented engine methods
export type EngineContext<T = any> = {
  engine: string;
  nodes: Record<string, NodeContext>;
  runtime: T;
  debuggingNonsense: {
    vertexSource?: string;
    vertexPreprocessed?: string;
    fragmentPreprocessed?: string;
    fragmentSource?: string;
  };
};

export const extendNodeContext = (
  context: EngineContext,
  nodeId: string,
  nodeContext: Partial<NodeContext>
) => ({
  ...context,
  nodes: {
    ...context.nodes,
    [nodeId]: {
      ...(context.nodes[nodeId] || {}),
      ...nodeContext,
    },
  },
});
export const extendNodesContext = (
  context: EngineContext,
  nodesContext: NodeContexts
) => ({
  ...context,
  nodes: {
    ...context.nodes,
    ...nodesContext,
  },
});

export type EngineImporter = {
  convertAst(
    ast: Program,
    options?: Record<string, unknown> & {
      type?: ShaderStage;
    }
  ): void;
  nodeInputMap: Partial<Record<EngineNodeType, Record<string, string | null>>>;
  edgeMap: { [oldInput: string]: string };
  code?: Record<string, string>;
};

export type EngineImporters = {
  [engine: string]: EngineImporter;
};

// type EdgeUpdates = { [edgeId: string]: { oldInput: string; newInput: string } };

export const convertNode = (
  node: SourceNode,
  converter: EngineImporter
): SourceNode => {
  log(`Converting ${node.name} (${node.id})`);
  const preprocessed = preprocess(node.source, {
    preserveComments: true,
    preserve: {
      version: () => true,
      define: () => true,
    },
  });
  const ast = parser.parse(preprocessed, { stage: node.stage });
  converter.convertAst(ast, { type: node.stage });
  const source = generate(ast);

  return {
    ...node,
    source,
  };
};

export const convertToEngine = (
  oldEngine: Engine,
  newEngine: Engine,
  graph: Graph
): Graph => {
  const converter = newEngine.importers[oldEngine.name];
  if (!converter) {
    throw new Error(
      `The engine ${newEngine.name} has no importer for ${oldEngine.name}`
    );
  }

  log(`Attempting to convert from ${newEngine.name} to ${oldEngine.name}`);

  // const edgeUpdates: EdgeUpdates = {};

  const edgesByNodeId = groupBy(graph.edges, 'to');
  const edgeUpdates: Record<string, Edge | null> = {};
  const nodeUpdates: Record<string, GraphNode | null> = {};

  graph.nodes.forEach((node) => {
    // Convert engine nodes
    if (node.type in EngineNodeType) {
      if (node.type in newEngine.constructors) {
        const source = node as SourceNode;
        nodeUpdates[source.id] = // @ts-ignore
          (newEngine.constructors[source.type] as PhysicalNodeConstructor)(
            source.id,
            source.name,
            source.position,
            source.config.uniforms,
            source.stage
          );
        // Bail if no conversion
      } else {
        throw new Error(
          `Can't convert ${oldEngine.name} to ${newEngine.name} because ${newEngine.name} does not have a "${node.type}" constructor`
        );
      }
    } else if (NodeType.SOURCE === node.type) {
      nodeUpdates[node.id] = convertNode(node, converter);
    }

    // Then update input edges. We only care about engine nodes
    if (node.type in converter.nodeInputMap) {
      const map = converter.nodeInputMap[node.type as EngineNodeType]!;

      (edgesByNodeId[node.id] || []).forEach((edge) => {
        if (edge.input in map) {
          const mapped = map[edge.input]!;
          log('Converting edge', edge.input, 'to', map[edge.input]);
          edgeUpdates[edge.id] = {
            ...edge,
            input: mapped,
          };
        } else {
          log(
            'Discarding',
            edge.input,
            'as there is no edge mapping in the',
            newEngine.name,
            'importer'
          );
          edgeUpdates[edge.id] = null;
        }
      });
    }
  });

  graph.edges = graph.edges.reduce<Edge[]>((edges, edge) => {
    if (edge.id in edgeUpdates) {
      const res = edgeUpdates[edge.id];
      if (res === null) {
        return edges;
      } else {
        return [...edges, res];
      }
    }
    return [...edges, edge];
  }, []);

  graph.nodes = graph.nodes.reduce<GraphNode[]>((nodes, node) => {
    if (node.id in nodeUpdates) {
      const res = nodeUpdates[node.id];
      if (res === null) {
        return nodes;
      } else {
        return [...nodes, res];
      }
    }
    return [...nodes, node];
  }, []);

  log('Created converted graph', graph);
  return graph;
};

export type DefaultPropertySetter = (p: NodeProperty) => any;

/**
 * Create the initial engine node properties for a plugin to create its initial
 * material with. This finds all engine nodes in the graph, finds all their
 * properties, evalutes them, and returns an object with initial properties to
 * set on the new plugin material, like a three.RawShaderMaterial().
 *
 * Currently only PlayCanvas uses this. It's at odds with the compileResult.dataInputs
 * code path. That path uses isDataNode() to check for inputs, which excludes
 * baked inputs. PlayCanvas requires (at least diffusesMap?) baked input properties
 * to be set to a pc.Texture() at runtime, otherwise there's an error about
 * vertex_texCoord0.
 */
export const collectInitialEvaluatedGraphProperties = (
  engine: Engine,
  graph: Graph,
  defaultPropertySetting: DefaultPropertySetter
) => {
  const graphProperties: Record<string, any> = {};

  // Get all the nodes with properties, meaning engine nodes, and the inputs
  // for each property (property is like "diffuseMap").
  const { nodes, inputs } = collectNodeProperties(graph);

  Object.entries(inputs).forEach(([nodeId, nodeInputs]) => {
    // For every node with properties... There might be mulitple if there are
    // uniforms plugged into both frag and vertex engine nodes, which
    const node = nodes[nodeId] as CodeNode;
    nodeInputs.forEach((i) => {
      // Cast this to an input with a property specified on it, which the
      // predicate search enforces
      const input = i as NodeInput & { property: string };
      const edge = graph.edges.find(
        ({ to, input: i }) => to === node.id && i === input.id
      );
      // In the case where a node has been deleted from the graph,
      // dataInputs won't have been udpated until a recompile completes
      const fromNode = edge && graph.nodes.find(({ id }) => id === edge.from);
      if (fromNode) {
        // If this is a baked input, we need to set the engine property to force
        // whatever we're baking to generate.
        if (input.baked) {
          // Find the corresponding property on the node and get the default
          // setting
          const property = (node.config.properties || []).find(
            (p) => p.property === input.property
          );
          if (property) {
            graphProperties[input.property] = defaultPropertySetting(property);
          } else {
            console.error('Property not found on input node', node, input);
            throw new Error('Property not found on input node');
          }
          // Other inputs should(?) be data if not baked
        } else {
          try {
            graphProperties[input.property] = evaluateNode(
              engine,
              graph,
              fromNode
            );
          } catch (err) {
            console.error('Tried to evaluate a non-data node!', {
              err,
            });
          }
        }
      }
    });
  });

  return graphProperties;
};
