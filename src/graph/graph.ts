import {
  renameBindings,
  renameFunctions,
} from '@shaderfrog/glsl-parser/parser/utils';
import { Program } from '@shaderfrog/glsl-parser/ast';
import { Engine, EngineContext } from '../engine';
import {
  NodeContext,
  NodeErrors,
  computeGraphContext,
  isError,
} from './context';
import {
  shaderSectionsCons,
  findShaderSections,
  mergeShaderSections,
  ShaderSections,
  shaderSectionsToProgram,
} from './shader-sections';
import { backfillAst, FrogProgram, makeExpression } from '../util/ast';
import { ensure } from '../util/ensure';
import { DataNode } from './data-nodes';
import { Edge } from './edge';
import { CodeNode, SourceNode, SourceType } from './code-nodes';
import { nodeInput, NodeInput } from './base-node';
import { makeId } from '../util/id';
import { ProduceNodeFiller, coreParsers } from './parsers';
import { toGlsl } from './evaluate';
import {
  EdgeLink,
  Graph,
  GraphNode,
  MAGIC_OUTPUT_STMTS,
  NodeType,
} from './graph-types';
import { generate } from '@shaderfrog/glsl-parser';
import { Filler, InputFillerGroup } from '../strategy';

const log = (...args: any[]) =>
  console.log.call(console, '\x1b[31m(core.graph)\x1b[0m', ...args);

export const isDataNode = (node: GraphNode): node is DataNode =>
  'value' in node;

export const isSourceNode = (node: GraphNode): node is SourceNode =>
  !isDataNode(node);

export const indexById = <T extends { id: string | number }>(records: T[]) =>
  records.reduce<Record<string, T>>(
    (acc, record) => ({ ...acc, [record.id]: record }),
    {}
  );

/**
 * Determine if a node's source code / AST should have a main function. Essentially
 * check if the source code is a full program or not.
 */
export const shouldNodeHaveMainFn = (node: GraphNode): node is SourceNode =>
  // Some legacy shaders have an output node that does not have a sourceType,
  // otherwise the sourceType second check would always work
  node.type === NodeType.OUTPUT ||
  // Same for code nodes :(
  (isSourceNode(node) && !(node as CodeNode).sourceType) ||
  (node as CodeNode).sourceType === SourceType.SHADER_PROGRAM ||
  // Engine nodes can have rando types like "physical", so if they are engine
  // nodes, assume they have a main fn.
  (node as CodeNode).engine;

export const findNode = (graph: Graph, id: string): GraphNode =>
  ensure(graph.nodes.find((node) => node.id === id));

export const doesLinkThruShader = (graph: Graph, node: GraphNode): boolean => {
  const edges = graph.edges.filter(
    (edge) => edge.type !== EdgeLink.NEXT_STAGE && edge.from === node.id
  );
  if (edges.length === 0) {
    return false;
  }
  return edges.reduce<boolean>((foundShader, edge: Edge) => {
    const upstreamNode = ensure(
      graph.nodes.find((node) => node.id === edge.to)
    );
    return (
      foundShader ||
      // TODO: LARD this probably will introduce some insidius hard to track
      // down bug, as I try to pull toon and phong up out of core, I need to
      // know if a graph links through a "shader" which now means somehting
      // different... does a config object need isShader? Can we compute it from
      // inputs/ outputs/source?
      ((upstreamNode as CodeNode).sourceType !== SourceType.EXPRESSION &&
        upstreamNode.type !== NodeType.OUTPUT) ||
      doesLinkThruShader(graph, upstreamNode)
    );
  }, false);
};

export const nodeName = (node: GraphNode): string =>
  'main_' + node.name.replace(/[^a-zA-Z0-9]/g, ' ').replace(/ +/g, '_');

export const resultName = (node: GraphNode): string => nodeName(node) + '_out';

export const mangleName = (
  name: string,
  node: GraphNode,
  nextSibling?: GraphNode
) => {
  // Mangle a name to its next stage node, so the vertex suffix becomes the
  // fragment id, but not the other way around.
  const id =
    (nextSibling as SourceNode)?.stage === 'fragment'
      ? nextSibling?.id
      : node.id;
  return `${name}_${id}`;
};

export const mangleVar = (
  name: string,
  engine: Engine,
  node: GraphNode,
  sibling?: GraphNode
) => (engine.preserve.has(name) ? name : mangleName(name, node, sibling));

export const mangleEntireProgram = (
  engine: Engine,
  ast: FrogProgram,
  node: GraphNode,
  sibling?: GraphNode
) => {
  ast.scopes[0].bindings = renameBindings(ast.scopes[0].bindings, (name) =>
    name === ast.outVar ? name : mangleVar(name, engine, node, sibling)
  );
  mangleMainFn(ast, node, sibling);
};

export const mangleMainFn = (
  ast: Program,
  node: GraphNode,
  sibling?: GraphNode
) => {
  ast.scopes[0].functions = renameFunctions(ast.scopes[0].functions, (name) =>
    name === 'main' ? nodeName(node) : mangleName(name, node, sibling)
  );
};

export const ensureFromNode = (graph: Graph, inputEdge: Edge) =>
  ensure(
    graph.nodes.find(({ id }) => id === inputEdge.from),
    `Orphaned edge! There is an edge fro "${inputEdge.from}" to "${inputEdge.to}", but from node ${inputEdge.from} does not exist in the graph.`
  );

export const resetGraphIds = (graph: Graph): Graph => {
  const idMap: Record<string, string> = {};
  const map = (id: string) => {
    idMap[id] = idMap[id] || makeId();
    return idMap[id];
  };
  return {
    nodes: graph.nodes.map((n) => ({
      ...n,
      id: map(n.id),
      ...(n.parentId ? { parentId: map(n.parentId) } : {}),
    })),
    edges: graph.edges.map((e) => ({
      ...e,
      id: map(e.id),
      from: map(e.from),
      to: map(e.to),
    })),
  };
};

export const findLinkedNode = (graph: Graph, nodeId: string) => {
  const edgeLink = graph.edges.find(
    (e) =>
      e.type === EdgeLink.NEXT_STAGE && (e.from === nodeId || e.to === nodeId)
  );
  const otherId = edgeLink?.from === nodeId ? edgeLink?.to : edgeLink?.from;

  // Only source nodes can be linked, so cast it
  return graph.nodes.find((node): node is SourceNode => node.id === otherId);
};

/**
 * Find any unconnected vertex nodes linked to collected fragment nodes
 */
export const findLinkedVertexNodes = (
  graph: Graph,
  existingIds: NodeIds = {}
) => {
  // Group edges by where they point
  const edgeLinks = graph.edges
    .filter((e) => e.type === EdgeLink.NEXT_STAGE)
    .reduce<Record<string, Edge>>(
      (edges, edge) => ({ ...edges, [edge.to]: edge, [edge.from]: edge }),
      {}
    );

  return graph.nodes.filter(
    (node) =>
      // If this is a vertex node
      isSourceNode(node) &&
      node.stage === 'vertex' &&
      // That's linked
      node.id in edgeLinks &&
      // And not already captured (this should probably just be a set)
      !existingIds[node.id]
  );
};

export type Predicates = {
  node?: (
    node: GraphNode,
    inputEdges: Edge[],
    lastResult: SearchResult
  ) => boolean;
  edge?: (
    input: NodeInput | undefined,
    node: GraphNode,
    inputEdge: Edge | undefined,
    fromNode: GraphNode | undefined,
    lastResult: SearchResult
  ) => boolean;
  input?: (
    input: NodeInput,
    node: GraphNode,
    inputEdge: Edge | undefined,
    fromNode: GraphNode | undefined,
    lastResult: SearchResult
  ) => boolean;
};
export type SearchResult = {
  // Grouped by node id
  nodes: Record<string, GraphNode>;
  // Grouped by node id since inputs are attached to a node
  inputs: Record<string, NodeInput[]>;
  // Edges aren't grouped because consumers might need to look up by from/to,
  // we don't know here
  edges: Record<string, Edge>;
};
export const consSearchResult = (): SearchResult => ({
  nodes: {},
  inputs: {},
  edges: {},
});
export const mergeSearchResults = (
  a: SearchResult,
  b: SearchResult
): SearchResult => ({
  nodes: { ...a.nodes, ...b.nodes },
  inputs: { ...a.inputs, ...b.inputs },
  edges: { ...a.edges, ...b.edges },
});

/**
 * Create the inputs on a node from the properties. This used to be done at
 * context time. Doing it at node creation time lets us auto-bake edges into
 * the node at initial graph creation time.
 */
export const prepopulatePropertyInputs = (node: CodeNode): CodeNode => ({
  ...node,
  inputs: [
    ...node.inputs,
    ...(node.config.properties || []).map((property) =>
      nodeInput(
        property.displayName,
        `property_${property.property}`,
        'property',
        property.type,
        ['data'],
        !!property.fillerName, // bakeable
        property.property
      )
    ),
  ],
});

/**
 * Recursively filter the graph, starting from a specific node, looking for
 * nodes and edges that match predicates.
 *
 * Inputs can only be filtered if the graph context has been computed, since
 * inputs aren't created until then.
 */
export const filterGraphFromNode = (
  graph: Graph,
  node: GraphNode,
  predicates: Predicates,
  depth = Infinity,
  lastResult = consSearchResult()
): SearchResult => {
  const { inputs } = node;
  const inputEdges = graph.edges.filter((edge) => edge.to === node.id);

  const nodeAcc = {
    ...(predicates.node && predicates.node(node, inputEdges, lastResult)
      ? { [node.id]: node }
      : {}),
  };
  const accumulatedResult = {
    ...lastResult,
    nodes: { ...lastResult.nodes, ...nodeAcc },
  };

  return inputEdges.reduce<SearchResult>((acc, inputEdge) => {
    const input = inputs.find((i) => i.id === inputEdge.input);

    const fromNode = inputEdge ? ensureFromNode(graph, inputEdge) : undefined;

    const inputAcc = {
      ...acc.inputs,
      ...(input &&
      predicates.input &&
      predicates.input(input, node, inputEdge, fromNode, lastResult)
        ? { [node.id]: [...(acc.inputs[node.id] || []), input] }
        : {}),
    };
    const edgeAcc = {
      ...acc.edges,
      ...(predicates.edge &&
      predicates.edge(input, node, inputEdge, fromNode, lastResult)
        ? { [inputEdge.id]: inputEdge }
        : {}),
    };

    // Add in the latest result of edges and inputs so that when we recurse into
    // the next node, it has the latest accumulator
    const intermediateAcc = {
      ...acc,
      inputs: inputAcc,
      edges: edgeAcc,
    };

    if (inputEdge && fromNode && depth > 1) {
      const result = filterGraphFromNode(
        graph,
        fromNode,
        predicates,
        depth - 1,
        intermediateAcc
      );

      // The result is automatically the combination of the currenet acc and the
      // result of the recursed data
      return result;
    } else {
      return intermediateAcc;
    }
  }, accumulatedResult);
};

export const collectConnectedNodes = (graph: Graph, node: GraphNode): NodeIds =>
  filterGraphFromNode(graph, node, { node: () => true }).nodes;

export const filterGraphNodes = (
  graph: Graph,
  nodes: GraphNode[],
  filter: Predicates,
  depth = Infinity
) =>
  nodes.reduce<SearchResult>((acc, node) => {
    const result = filterGraphFromNode(graph, node, filter, depth);
    return {
      nodes: { ...acc.nodes, ...result.nodes },
      inputs: { ...acc.inputs, ...result.inputs },
      edges: { ...acc.edges, ...result.edges },
    };
  }, consSearchResult());

type NodeIds = Record<string, GraphNode>;

export type CompileNodeResult = [
  // After compiling a node and all of its dependencies, the ShaderSections
  // represent the intermediate compile result, continues to grow as the graph
  // is compiled.
  compiledSections: ShaderSections,
  // The filler this node offers up to any filling nodes
  filler: ReturnType<ProduceNodeFiller>,
  // All of the nodes compiled as dependencies of this node, continues to grow
  // as the graph is compiled.
  compiledIds: NodeIds
];

// before data inputs were known by the input.category being node or data. I
// tried updating inputs to have acepts: [code|data] and "baked" now is there a
// way to know if we're plugging in code or data?
export const isDataInput = (input: NodeInput) =>
  (input.type === 'uniform' || input.type === 'property') && !input.baked;

export const compileNode = (
  engine: Engine,
  graph: Graph,
  edges: Edge[],
  engineContext: EngineContext,
  node: GraphNode,
  activeIds: NodeIds = {}
): CompileNodeResult => {
  // THIS DUPLICATES OTHER LINE
  const parser = {
    ...(coreParsers[node.type] || coreParsers[NodeType.SOURCE]),
    ...(engine.parsers[node.type] || {}),
  };
  const codeNode = node as CodeNode;

  const { inputs } = node;

  if (!parser) {
    console.error(node);
    throw new Error(
      `No parser found for ${node.name} (${node.type}, id ${node.id})`
    );
  }

  const nodeContext = isDataNode(node)
    ? null
    : ensure(
        engineContext.nodes[node.id],
        `No node context found for "${node.name}" (id ${node.id})!`
      );
  const { ast, inputFillers } = (nodeContext || {}) as NodeContext;
  if (!inputs) {
    throw new Error("I'm drunk and I think this case should be impossible");
  }

  let compiledIds = activeIds;

  const inputEdges = edges.filter((edge) => edge.to === node.id);
  let continuation = shaderSectionsCons();

  // Compile children recursively
  inputEdges
    .filter((edge) => edge.type !== EdgeLink.NEXT_STAGE)
    .map((edge) => ({
      edge,
      fromNode: ensure(
        graph.nodes.find((node) => edge.from === node.id),
        `GraphNode for edge ${edge.from} not found`
      ),
      input: ensure(
        inputs.find(({ id }) => id == edge.input),
        `GraphNode "${node.name}"${
          (node as SourceNode).stage ? ` (${(node as SourceNode).stage})` : ''
        } has no input ${edge.input}!\nAvailable:${inputs
          .map(({ id }) => id)
          .join(', ')}`
      ),
    }))
    .filter(({ input }) => !isDataInput(input))
    .forEach(({ fromNode, input }) => {
      // const [inputSections, fillerFn, childIds, childDeps] = compileNode(
      const [inputSections, fillerFn, childIds] = compileNode(
        engine,
        graph,
        edges,
        engineContext,
        fromNode,
        activeIds
      );
      if (!fillerFn) {
        throw new TypeError(
          `Expected a filler ast from node ID ${fromNode.id} (${fromNode.type}) but none was returned`
        );
      }

      continuation = mergeShaderSections(continuation, inputSections);
      compiledIds = { ...compiledIds, ...childIds };

      // Continue on if there's no context I don't know what case causes this
      if (!nodeContext) {
        return;
      }

      // Produce the input filler
      let filler: InputFillerGroup;
      let fillerName: string | undefined;
      if (input.property) {
        fillerName = ensure(
          (codeNode.config.properties || []).find(
            (p) => p.property === input.property
          )?.fillerName,
          `Node "${node.name}" has no property named "${input.property}" to find the filler for`
        );
        filler = inputFillers[fillerName];
      } else {
        filler = inputFillers[input.id];
      }
      if (!filler) {
        console.error('No filler for property', {
          input,
          node,
          inputFillers,
          fillerName,
        });
        return;
        // throw new Error(
        //   `Node "${node.name}"${
        //     (node as SourceNode).stage ? ` (${(node as SourceNode).stage})` : ''
        //   } has no filler for input "${input.displayName}" named ${fillerName}`,
        // );
      }

      // Test if it needs to be backfilled - this only goes one level deep
      // because we're only backfilling fromNode
      let backfillers = codeNode.backfillers?.[input.id];
      if (backfillers && shouldNodeHaveMainFn(fromNode)) {
        const childAst = engineContext.nodes[fromNode.id].ast;
        // For now we can only backfill programs
        if (childAst.type === 'program') {
          backfillers.forEach((backfiller) => {
            // This is where the variable name gets injected into the main
            // function parameter of the backfilled child
            backfillAst(
              childAst,
              backfiller.argType,
              backfiller.targetVariable,
              engineContext.nodes[fromNode.id].mainFn
            );
          });
        }
        nodeContext.ast = filler.filler(fillerFn);
      } else {
        // Don't backfill by discarding the backfiller args
        nodeContext.ast = filler.filler(() => fillerFn());
      }
    });

  // Order matters here! *Prepend* the input nodes to this one, because
  // you have to declare functions in order of use in GLSL
  const sections = mergeShaderSections(
    continuation,
    isDataNode(node) ||
      codeNode.sourceType === SourceType.EXPRESSION ||
      codeNode.sourceType === SourceType.FN_BODY_FRAGMENT
      ? shaderSectionsCons()
      : findShaderSections(node.id, ast as Program)
  );

  const filler: Filler = isDataNode(node)
    ? () => makeExpression(toGlsl(node))
    : parser.produceFiller(node, ast);

  return [sections, filler, { ...compiledIds, [node.id]: node }];
};

export type CompileGraphResult = {
  fragment: ShaderSections;
  vertex: ShaderSections;
  outputFrag: GraphNode;
  outputVert: GraphNode;
  orphanNodes: GraphNode[];
  activeNodeIds: Set<string>;
};

export const compileGraph = (
  engineContext: EngineContext,
  engine: Engine,
  graph: Graph
): CompileGraphResult => {
  // computeGraphContext(engineContext, engine, graph);

  const outputFrag = graph.nodes.find(
    (node) => node.type === 'output' && node.stage === 'fragment'
  );
  if (!outputFrag) {
    throw new Error('No fragment output in graph');
  }

  const [fragment, , fragmentIds] = compileNode(
    engine,
    graph,
    graph.edges,
    engineContext,
    outputFrag
  );

  const outputVert = graph.nodes.find(
    (node) => node.type === 'output' && node.stage === 'vertex'
  );
  if (!outputVert) {
    throw new Error('No vertex output in graph');
  }

  const vertexIds = collectConnectedNodes(graph, outputVert);

  // Some fragment shaders reference vertex shaders which may not have been
  // given edges in the graph. Build invisible edges from these vertex nodes to
  // the hidden "mainStmts" input on the output node, which inlines the function
  // calls to those vertex main() statements and includes them in the output
  const orphanNodes = findLinkedVertexNodes(graph, vertexIds);

  const orphanEdges: Edge[] = orphanNodes.map((node) => ({
    id: makeId(),
    from: node.id,
    to: outputVert.id,
    output: 'main',
    input: `filler_${MAGIC_OUTPUT_STMTS}`,
    stage: 'vertex',
    category: 'code',
  }));

  const [vertex, ,] = compileNode(
    engine,
    graph,
    [...graph.edges, ...orphanEdges],
    engineContext,
    outputVert
  );

  // Every compileNode returns the AST so far, as well as the filler for the
  // next node with inputs. On the final step, we discard the filler
  return {
    fragment,
    vertex,
    outputFrag,
    outputVert,
    orphanNodes,
    activeNodeIds: new Set<string>([
      ...Object.keys(vertexIds),
      ...Object.keys(fragmentIds),
      ...orphanNodes.map((node) => node.id),
    ]),
  };
};

/**
 * Find engine nodes to set properties on, like find a Physical node so
 * consumers can set physicalNode.myProperty = 123.
 *
 * Finds all active nodes in the graph that have inputs that are properties,
 * which currently means it will find all active engine nodes.
 */
export const collectNodeProperties = (graph: Graph): SearchResult => {
  const nodesWithProperties: Predicates = {
    node: (node) =>
      'config' in node &&
      'properties' in node.config &&
      !!node.config.properties?.length,
    input: (input) => !!input.property,
  };

  const outputFrag = graph.nodes.find(
    (node) => node.type === 'output' && node.stage === 'fragment'
  ) as GraphNode;
  const outputVert = graph.nodes.find(
    (node) => node.type === 'output' && node.stage === 'vertex'
  ) as GraphNode;
  const fragProperties = filterGraphFromNode(
    graph,
    outputFrag,
    nodesWithProperties
  );
  const vertProperties = filterGraphFromNode(
    graph,
    outputVert,
    nodesWithProperties
  );

  return {
    nodes: { ...fragProperties.nodes, ...vertProperties.nodes },
    inputs: { ...fragProperties.inputs, ...vertProperties.inputs },
    edges: { ...fragProperties.edges, ...vertProperties.edges },
  };
};

export type IndexedDataInputs = Record<string, NodeInput[]>;

export type CompileResult = {
  fragmentResult: string;
  vertexResult: string;
  compileResult: CompileGraphResult;
  dataNodes: Record<string, GraphNode>;
  dataInputs: IndexedDataInputs;
  compileMs: string;
};

export const compileSource = async (
  graph: Graph,
  engine: Engine,
  ctx: EngineContext
): Promise<CompileResult | NodeErrors> => {
  const result = await computeGraphContext(ctx, engine, graph);
  if (isError(result)) {
    return result;
  }
  const updatedContext = {
    ...ctx,
    nodes: {
      ...ctx.nodes,
      ...result,
    },
  };

  const compileResult = compileGraph(updatedContext, engine, graph);

  const fragmentResult = generate(
    shaderSectionsToProgram(compileResult.fragment, engine.mergeOptions).program
  );
  const vertexResult = generate(
    shaderSectionsToProgram(compileResult.vertex, engine.mergeOptions).program
  );

  const dataInputs = filterGraphNodes(
    graph,
    [compileResult.outputFrag, compileResult.outputVert],
    { input: isDataInput }
  ).inputs;

  // Find which nodes flow up into uniform inputs, for colorizing and for
  // not recompiling when their data changes
  const dataNodes = Object.entries(dataInputs).reduce<
    Record<string, GraphNode>
  >((acc, [nodeId, inputs]) => {
    return inputs.reduce((iAcc, input) => {
      const fromEdge = graph.edges.find(
        (edge) => edge.to === nodeId && edge.input === input.id
      );
      const fromNode =
        fromEdge && graph.nodes.find((node) => node.id === fromEdge.from);
      return fromNode
        ? {
            ...iAcc,
            ...collectConnectedNodes(graph, fromNode),
          }
        : iAcc;
    }, acc);
  }, {});

  return {
    compileResult,
    fragmentResult,
    vertexResult,
    dataNodes,
    dataInputs,
    compileMs: '',
  };
};
