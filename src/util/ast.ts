/**
 * Utility functions to work with ASTs
 */

import { parse, generate } from '@shaderfrog/glsl-parser';
import {
  visit,
  AstNode,
  NodeVisitors,
  ExpressionStatementNode,
  FunctionNode,
  DeclarationStatementNode,
  KeywordNode,
  DeclarationNode,
  AssignmentNode,
  IdentifierNode,
  TypeSpecifierNode,
  DeclaratorListNode,
  FloatConstantNode,
  ReturnStatementNode,
  LiteralNode,
} from '@shaderfrog/glsl-parser/ast';
import { Program } from '@shaderfrog/glsl-parser/ast';
import { ShaderStage } from '../graph/graph-types';
import { Scope } from '@shaderfrog/glsl-parser/parser/scope';
import { addFnStmtWithIndent } from './whitespace';
import { Filler } from '../strategy';
import { renameBinding } from '@shaderfrog/glsl-parser/parser/utils';

const log = (...args: any[]) =>
  console.log.call(console, '\x1b[31m(core.manipulate)\x1b[0m', ...args);

export interface FrogProgram extends Program {
  outVar?: string;
}

export const makeLiteral = (literal: string, whitespace = ''): LiteralNode => ({
  type: 'literal',
  literal,
  whitespace,
});

export const findVec4Constructor = (ast: AstNode): AstNode | undefined => {
  let parent: AstNode | undefined;
  const visitors: NodeVisitors = {
    function_call: {
      enter: (path) => {
        if (
          (
            (path.node.identifier as TypeSpecifierNode)
              ?.specifier as KeywordNode
          ).token === 'vec4'
        ) {
          parent = path.findParent((p) => 'right' in p.node)?.node;
          path.skip();
        }
      },
    },
  };
  visit(ast, visitors);
  return parent;
};

export const findAssignmentTo = (
  ast: AstNode | Program,
  assignTo: string,
  nth = 1,
) => {
  let assign: ExpressionStatementNode | DeclarationNode | undefined;
  let foundth = 0;
  const visitors: NodeVisitors = {
    expression_statement: {
      enter: (path) => {
        if (
          ((path.node.expression as AssignmentNode)?.left as IdentifierNode)
            ?.identifier === assignTo
        ) {
          foundth++;
          if (foundth === nth) {
            assign = path.node;
            path.stop();
          }
        }
        path.skip();
      },
    },
    declaration_statement: {
      enter: (path) => {
        const foundDecl = (
          path.node.declaration as DeclaratorListNode
        )?.declarations?.find(
          (decl) => decl?.identifier?.identifier === assignTo,
        );
        if (foundDecl?.initializer) {
          foundth++;
          if (foundth === nth) {
            assign = foundDecl;
            path.stop();
          }
        }
        path.skip();
      },
    },
  };
  visit(ast, visitors);
  return assign;
};

export const findDeclarationOf = (
  ast: AstNode | Program,
  declarationOf: string,
): DeclarationNode | undefined => {
  let declaration: DeclarationNode | undefined;
  const visitors: NodeVisitors = {
    declaration_statement: {
      enter: (path) => {
        const foundDecl = (
          path.node.declaration as DeclaratorListNode
        )?.declarations?.find(
          (decl) => decl?.identifier?.identifier === declarationOf,
        );
        if (foundDecl) {
          declaration = foundDecl;
        }
        path.skip();
      },
    },
  };
  visit(ast, visitors);
  return declaration;
};

export const from2To3 = (ast: Program, stage: ShaderStage) => {
  const glOut = 'fragmentColor';
  // TODO: add this back in when there's only one after the merge
  // ast.program.unshift({
  //   type: 'preprocessor',
  //   line: '#version 300 es',
  //   _: '\n',
  // });
  if (stage === 'fragment') {
    // Add in "out vec4 fragmentColor" to convert gl_FragColor to an out statement
    const [outStmt, scope] = makeStatement(`out vec4 ${glOut}`);
    ast.program.unshift(outStmt as DeclarationStatementNode);
    // Add the out statement variable to the scope
    ast.scopes[0] = addNewScope(ast.scopes[0], scope);
  }
  visit(ast, {
    function_call: {
      enter: (path) => {
        const identifier = path.node.identifier;
        if (
          identifier.type === 'identifier' &&
          identifier.identifier === 'texture2D'
        ) {
          identifier.identifier = 'texture';
        }
      },
    },
    identifier: {
      enter: (path) => {
        if (path.node.identifier === 'gl_FragColor') {
          path.node.identifier = glOut;
          ast.scopes[0].bindings[glOut].references.push(path.node);
        }
      },
    },
    keyword: {
      enter: (path) => {
        if (
          (path.node.token === 'attribute' || path.node.token === 'varying') &&
          path.findParent((path) => path.node.type === 'declaration_statement')
        ) {
          path.node.token =
            stage === 'vertex' && path.node.token === 'varying' ? 'out' : 'in';
        }
      },
    },
  });
};

export const makeStatement = (stmt: string, ws = '') => {
  // log(`Parsing "${stmt}"`);
  let ast: Program;
  try {
    ast = parse(
      `${stmt};${ws}
`,
      { quiet: true },
    );
  } catch (error: any) {
    console.error({ stmt, error });
    throw new Error(`Error parsing stmt "${stmt}": ${error?.message}`);
  }
  // log(util.inspect(ast, false, null, true));
  return [ast.program[0], ast.scopes[0]] as const;
};

export const makeFnStatement = (fnStmt: string) => {
  let ast: FrogProgram;
  try {
    // Create a statement with no trailing nor leading whitespace
    ast = parse(`void main() {${fnStmt};}`, { quiet: true });
  } catch (error: any) {
    console.error({ fnStmt, error });
    throw new Error(`Error parsing fnStmt "${fnStmt}": ${error?.message}`);
  }

  // log(util.inspect(ast, false, null, true));
  const n = (ast.program[0] as FunctionNode).body.statements[0];
  (n as ExpressionStatementNode).semi.whitespace = '';
  return [n, ast.scopes[1]] as const;
};

/**
 * Add a new scope into an existing one. Meant to be used for adding net new
 * lines of coe to an AST, and wanting to add the new scope generated from those
 * lines.
 *
 * DO NOT USE THIS TO MERGE SCOPES! If both the left and right scope contain the
 * same binding name, this will override the left scope outright, rather than
 * merge the binding.references.
 *
 * One reason I chose not to make a full merge: What happens if both sides
 * contain a binding.declaration?
 */
export const addNewScope = (left: Scope, right: Scope): Scope => ({
  ...left,
  // name, parent comes from left
  bindings: { ...left.bindings, ...right.bindings },
  types: { ...left.types, ...right.types },
  functions: { ...left.functions, ...right.functions },
});

export const makeExpression = (expr: string): AstNode => {
  let ast: Program;
  try {
    ast = parse(
      `void main() {
          a = ${expr};
        }`,
      { quiet: true },
    );
  } catch (error: any) {
    console.error({ expr, error });
    throw new Error(`Error parsing expr "${expr}": ${error?.message}`);
  }

  return (
    (
      (ast.program[0] as FunctionNode).body
        .statements[0] as ExpressionStatementNode
    ).expression as AssignmentNode
  ).right;
};

export const makeExpressionWithScopes = (
  expr: string,
): {
  scope: Scope;
  expression: AstNode;
} => {
  let ast: Program;
  try {
    ast = parse(
      `void main() {
          ${expr};
        }`,
      { quiet: true },
    );
  } catch (error: any) {
    console.error({ expr, error });
    throw new Error(`Error parsing expr "${expr}": ${error?.message}`);
  }

  // log(util.inspect(ast, false, null, true));
  return {
    scope: ast.scopes[1],
    expression: (
      (ast.program[0] as FunctionNode).body
        .statements[0] as ExpressionStatementNode
    ).expression,
  };
};

export const makeFnBodyStatementWithScopes = (
  body: string,
): {
  scope: Scope;
  statements: AstNode[];
} => {
  let ast: Program;
  try {
    ast = parse(
      `void main() {
${body}
        }`,
      { quiet: true },
    );
  } catch (error: any) {
    console.error({ body, error });
    throw new Error(`Error parsing body "${body}": ${error?.message}`);
  }

  // log(util.inspect(ast, false, null, true));
  return {
    scope: ast.scopes[1],
    statements: (ast.program[0] as FunctionNode).body.statements,
  };
};

export const findFn =
  (name: string) =>
  (ast: Program): FunctionNode | undefined =>
    ast.program.find(
      (stmt): stmt is FunctionNode =>
        stmt.type === 'function' &&
        stmt.prototype.header.name.identifier === name,
    );

export const findMain = findFn('main');

export const findMainOrThrow = (ast: Program) => {
  const main = findMain(ast);
  if (!main) {
    throw new Error('No main function found!');
  }
  return main;
};

export const returnGlPosition = (fnName: string, ast: Program): void =>
  convertVertexMain(
    fnName,
    ast,
    'vec4',
    (assign) => (assign.expression as AssignmentNode).right,
  );

export const returnGlPositionHardCoded = (
  fnName: string,
  ast: Program,
  returnType: string,
  hardCodedReturn: string,
): void =>
  convertVertexMain(fnName, ast, returnType, () =>
    makeExpression(hardCodedReturn),
  );

export const returnGlPositionVec3Right = (fnName: string, ast: Program): void =>
  convertVertexMain(fnName, ast, 'vec3', (assign) => {
    let found: AstNode | undefined;
    visit(assign, {
      function_call: {
        enter: (path) => {
          const { node } = path;
          if (
            ((node?.identifier as TypeSpecifierNode)?.specifier as KeywordNode)
              ?.token === 'vec4' &&
            (node?.args?.[2] as FloatConstantNode)?.token?.includes('1.')
          ) {
            found = node.args[0];
          }
        },
      },
    });
    if (!found) {
      console.error(generate(ast));
      throw new Error(
        'Could not find position assignment to convert to return!',
      );
    }
    return found;
  });

const replacedReturn = 'frogOut';

const convertVertexMain = (
  fnName: string,
  ast: Program,
  returnType: string,
  generateRight: (positionAssign: ExpressionStatementNode) => AstNode,
) => {
  const mainReturnVar = `frogOut`;

  const main = findFn(fnName)(ast);
  if (!main) {
    throw new Error(`No ${fnName} fn found!`);
  }

  // Convert the main function to one that returns
  (main.prototype.header.returnType.specifier.specifier as KeywordNode).token =
    returnType;

  // Find the gl_position assignment line
  const assign = main.body.statements.find(
    (stmt: AstNode): stmt is ExpressionStatementNode =>
      stmt.type === 'expression_statement' &&
      ((stmt.expression as AssignmentNode).left as IdentifierNode)
        ?.identifier === 'gl_Position',
  );
  if (!assign) {
    throw new Error(`No gl position assign found in main fn!`);
  }

  const rtnStmt = makeFnStatement(
    `${returnType} ${mainReturnVar} = 1.0`,
  )[0] as DeclarationStatementNode;
  (rtnStmt.declaration as DeclaratorListNode).declarations[0].initializer =
    generateRight(assign);
  rtnStmt.semi.whitespace = '\n';

  main.body.statements.splice(main.body.statements.indexOf(assign), 1, rtnStmt);
  main.body.statements = addFnStmtWithIndent(main, `return ${mainReturnVar}`);
};

/**
 * For either a fragment or vertex AST, convert the main() function that sets
 * gl_FragColor, gl_Position, or "out vec4 ____" into a main() function that
 * returns a vec4.
 */
export const convert300MainToReturn = (ast: FrogProgram): void => {
  // Convert the main function to return a vec4
  const main = findMainOrThrow(ast);
  (main.prototype.header.returnType.specifier.specifier as KeywordNode).token =
    'vec4';

  // Find the output variable, as in "pc_fragColor" from  "out highp vec4 pc_fragColor;"
  let outName: string | undefined;
  ast.program.find((line, index) => {
    const declaration = (line as DeclarationStatementNode)
      ?.declaration as DeclaratorListNode;
    if (
      // line.type === 'declaration_statement' &&
      declaration?.specified_type?.qualifiers?.find(
        (n) => (n as KeywordNode).token === 'out',
      ) &&
      (declaration.specified_type.specifier.specifier as KeywordNode).token ===
        'vec4'
    ) {
      // Remove the out declaration. This does NOT yet remove the declaration
      // from the scope, that's done below
      ast.program.splice(index, 1);

      outName = declaration.declarations[0].identifier.identifier;
      return true;
    }
  });
  if (!outName) {
    console.error(generate(ast));
    throw new Error('No "out vec4" line found in the fragment shader');
  }

  // Store the variable to avoid descoping it later
  ast.outVar = outName;

  // Rename the scope entry of "out vec4 ___" to our return variable, and rename
  // all references to our new variable
  ast.scopes[0].bindings[replacedReturn] = renameBinding(
    ast.scopes[0].bindings[outName],
    replacedReturn,
  );
  delete ast.scopes[0].bindings[outName];

  // Add the declaration of the return variable to the top of the program, and
  // add it to the AST scope, including the declaration
  const decl = makeStatement(
    `vec4 ${replacedReturn}`,
  )[0] as DeclarationStatementNode;
  ast.program.unshift(decl);
  ast.scopes[0].bindings[replacedReturn].declaration = decl;
  ast.scopes[0].bindings[replacedReturn].references.push(
    (decl.declaration as DeclaratorListNode).declarations[0],
  );

  // Add a return statement to the main() function and add the return variable
  // to scope
  const rtn = makeFnStatement(
    `return ${replacedReturn}`,
  )[0] as ReturnStatementNode;
  main.body.statements = addFnStmtWithIndent(main, rtn);
  ast.scopes[0].bindings[replacedReturn].references.push(rtn.expression);
};

export const generateFiller = (ast: AstNode | AstNode[] | void) => {
  if (!ast) {
    throw new Error('Cannot generate void filler!');
  }
  return Array.isArray(ast) ? ast.map(generate).join('') : generate(ast);
};

export const isDeclarationStatement = (
  node: Program['program'][0],
): node is DeclarationStatementNode =>
  node.type === 'declaration_statement' &&
  node.declaration.type === 'declarator_list';

export const backfillAst = (
  ast: Program,
  fromType: string,
  targetVariable: string,
  mainFn?: FunctionNode,
) => {
  if (!ast.scopes[0].bindings[targetVariable]) {
    console.warn(
      `Variable "${targetVariable}" not found in global program scope to backfill! Variables: ${Object.keys(
        ast.scopes[0].bindings,
      )}`,
    );
  }

  // Inject the backfill param as the arg
  if (mainFn) {
    mainFn.prototype.parameters = (mainFn.prototype.parameters || [])
      .filter(
        // Watch out for the main(void){} case!
        (arg) => (arg.specifier.specifier as KeywordNode).token !== 'void',
      )
      .concat(
        (
          parse(`void x(${fromType} ${targetVariable}) {}`)
            .program[0] as FunctionNode
        ).prototype.parameters,
      );
  }

  return ast;
};
