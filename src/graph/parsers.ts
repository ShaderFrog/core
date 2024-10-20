import { parser } from '@shaderfrog/glsl-parser';

import {
  visit,
  AstNode,
  NodeVisitors,
  Path,
  Program,
} from '@shaderfrog/glsl-parser/ast';
import { Engine, EngineContext } from '../engine';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import {
  convert300MainToReturn,
  findMainOrThrow,
  from2To3,
  makeExpression,
  makeExpressionWithScopes,
  makeFnBodyStatementWithScopes,
} from '../util/ast';
import { applyStrategy, ComputedInput, Filler } from '../strategy';
import { Edge } from './edge';
import { BinaryNode, SourceNode, SourceType } from './code-nodes';
import { nodeInput } from './base-node';
import { Graph, MAGIC_OUTPUT_STMTS, NodeType } from './graph-types';
import { nodeName } from './graph';
import { Evaluate } from './evaluate';
import { generateFiller } from '../util/ast';
import { unshiftFnStmtWithIndent } from '../util/whitespace';

/*
 * Core graph parsers, which is the plumbing/interface the graph and context
 * calls into, to parse, find inputs, etc, and define this per-node type.
 */

const log = (...args: any[]) =>
  console.log.call(console, '\x1b[31m(core.parsers)\x1b[0m', ...args);

export const alphabet = 'abcdefghijklmnopqrstuvwxyz';

export type ProduceAst = (
  engineContext: EngineContext,
  engine: Engine,
  graph: Graph,
  node: SourceNode,
  inputEdges: Edge[],
) => AstNode | Program;

export type OnBeforeCompile = (
  graph: Graph,
  engineContext: EngineContext,
  node: SourceNode,
  sibling?: SourceNode,
) => Promise<void>;

export type ManipulateAst = (
  engineContext: EngineContext,
  engine: Engine,
  graph: Graph,
  ast: AstNode | Program,
  inputEdges: Edge[],
  node: SourceNode,
  sibling: SourceNode,
) => AstNode | Program;

export type NodeParser = {
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

export type FindInputs = (
  engineContext: EngineContext,
  ast: Program | AstNode,
  inputEdges: Edge[],
  node: SourceNode,
  sibling?: SourceNode,
) => ComputedInput[];

export type ProduceNodeFiller = (
  node: SourceNode,
  ast: Program | AstNode,
) => Filler;

type CoreNodeParser = {
  produceAst: ProduceAst;
  findInputs: FindInputs;
  produceFiller: ProduceNodeFiller;
  evaluate?: Evaluate;
};

type CoreParser = { [key: string]: CoreNodeParser };

export const coreParsers: CoreParser = {
  [NodeType.SOURCE]: {
    produceAst: (engineContext, engine, graph, node, inputEdges) => {
      let ast: Program;

      // Load the source either from the computed source at runtime, or the
      // node's source code itself
      const source =
        engineContext.nodes[node.id]?.computedSource || node.source;

      // @ts-ignore
      if (node.expressionOnly) {
        node.sourceType = SourceType.EXPRESSION;
        // @ts-ignore
        delete node.expressionOnly;
      }

      if (node.sourceType === SourceType.FN_BODY_FRAGMENT) {
        const { statements, scope } = makeFnBodyStatementWithScopes(source);
        ast = {
          type: 'program',
          scopes: [scope],
          // @ts-ignore
          program: statements,
        };
      } else if (node.sourceType === SourceType.EXPRESSION) {
        const { expression, scope } = makeExpressionWithScopes(source);
        ast = {
          type: 'program',
          scopes: [scope],
          // @ts-ignore
          program: [expression as AstNode],
        };
      } else {
        const preprocessed =
          node.config.preprocess === false
            ? source
            : preprocess(source, {
                preserve: {
                  version: () => true,
                },
              });

        ast = parser.parse(preprocessed);

        if (node.config.version === 2 && node.stage) {
          from2To3(ast, node.stage);
        }

        // This assumes that expressionOnly nodes don't have a stage and that all
        // fragment source code shades have main function, which is probably wrong
        if (node.stage === 'fragment') {
          convert300MainToReturn(ast);
        }
      }

      return ast;
    },
    findInputs: (engineContext, ast, edges, node, sibling) => {
      let seen = new Set<string>();
      return node.config.strategies
        .flatMap((strategy) => applyStrategy(strategy, ast, node, sibling))
        .filter(([input, _]) => {
          if (!seen.has(input.id)) {
            seen.add(input.id);
            return true;
          }
          return false;
        });
    },
    produceFiller: (node, ast) => {
      return (...args) => {
        const fillerNode =
          node.sourceType === SourceType.EXPRESSION
            ? ((ast as Program).program[0] as AstNode)
            : node.sourceType === SourceType.FN_BODY_FRAGMENT
              ? ((ast as Program).program as AstNode[])
              : // Backfilling into the call of this program's filler.
                // Similar to texutre2D.ts filler
                makeExpression(`${nodeName(node)}(${args.join(', ')})`);
        return fillerNode;
      };
    },
  },
  // TODO: Output node assumes strategies are still passed in on node creation,
  // which might be a little awkward for graph creators?
  [NodeType.OUTPUT]: {
    produceAst: (engineContext, engine, graph, node, inputEdges) => {
      return parser.parse(node.source);
    },
    findInputs: (engineContext, ast, edges, node, sibling) => {
      return [
        ...node.config.strategies.flatMap((strategy) =>
          applyStrategy(strategy, ast, node, sibling),
        ),
        [
          nodeInput(
            MAGIC_OUTPUT_STMTS,
            `filler_${MAGIC_OUTPUT_STMTS}`,
            'filler',
            'rgba',
            ['code'],
            false,
          ),
          (filler) => {
            const main = findMainOrThrow(ast as Program);
            main.body.statements = unshiftFnStmtWithIndent(
              main,
              generateFiller(filler()),
            );
            return ast;
          },
        ] as ComputedInput,
      ];
    },
    produceFiller: (node, ast) => {
      return () => makeExpression('impossible_call()');
    },
  },
  [NodeType.BINARY]: {
    produceAst: (engineContext, engine, graph, iNode, inputEdges) => {
      const node = iNode as BinaryNode;
      return makeExpression(
        '(' +
          (inputEdges.length
            ? inputEdges
                .map((_, index) => alphabet.charAt(index))
                .join(` ${node.operator} `)
            : `a ${node.operator} b`) +
          ')',
      );
    },
    findInputs: (engineContext, ast, inputEdges, node, sibling) => {
      return new Array(Math.max(inputEdges.length + 1, 2))
        .fill(0)
        .map((_, index) => {
          const letter = alphabet.charAt(index);
          return [
            nodeInput(
              letter,
              letter,
              'filler',
              undefined,
              ['data', 'code'],
              false,
            ),
            (filler) => {
              let foundPath: Path<any> | undefined;
              const visitors: NodeVisitors = {
                identifier: {
                  enter: (path) => {
                    if (path.node.identifier === letter) {
                      foundPath = path;
                    }
                  },
                },
              };
              visit(ast, visitors);
              if (!foundPath) {
                throw new Error(
                  `Im drunk and I think this case is impossible, no "${letter}" found in binary node?`,
                );
              }

              if (foundPath.parent && foundPath.key) {
                // @ts-ignore
                foundPath.parent[foundPath.key] = filler();
                return ast;
              } else {
                return filler();
              }
            },
          ] as ComputedInput;
        });
    },
    produceFiller: (node, ast) => {
      return () => ast as AstNode;
    },
    evaluate: (node, inputEdges, inputNodes, evaluateNode) => {
      const operator = (node as BinaryNode).operator;
      return inputNodes.map<number>(evaluateNode).reduce((num, next) => {
        if (operator === '+') {
          return num + next;
        } else if (operator === '*') {
          return num * next;
        } else if (operator === '-') {
          return num - next;
        } else if (operator === '/') {
          return num / next;
        }
        throw new Error(
          `Don't know how to evaluate ${operator} for node ${node.name} (${node.id})`,
        );
      });
    },
  },
};
