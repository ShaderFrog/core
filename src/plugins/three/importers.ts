import {
  renameBindings,
  renameFunction,
} from '@shaderfrog/glsl-parser/parser/utils';
import { EngineImporters } from '../../engine';
import { findMainOrThrow, makeStatement } from '../../util/ast';

export const defaultShadertoyVertex = `
precision highp float;
precision highp int;

attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position * 2.0, 1.0);
}
`;

const importers: EngineImporters = {
  shadertoy: {
    code: {
      defaultShadertoyVertex,
    },
    convertAst: (ast, type) => {
      ast.program.unshift(
        makeStatement('uniform vec2 renderResolution', '\n')[0]
      );

      // These do not catch variables in preprocessor definitions! See "SAD HACK"
      //if (ast.scopes.some((s) => 'iTime' in s.bindings)) {
      ast.program.unshift(makeStatement('uniform float time')[0]);
      //}
      //if (ast.scopes.some((s) => 'iMouse' in s.bindings)) {
      ast.program.unshift(makeStatement('uniform vec2 mouse')[0]);
      //}

      ast.program.unshift(makeStatement('precision highp int', '\n')[0]);
      ast.program.unshift(makeStatement('precision highp float')[0]);

      ast.scopes[0].functions.main = renameFunction(
        ast.scopes[0].functions.mainImage,
        'main'
      );
      const main = findMainOrThrow(ast);
      main.prototype.parameters = [];
      main.prototype.header.lp.whitespace = '';
      main.prototype.rp.whitespace = ' ';

      // These renames do not catch variables in preprocessor definitions! See
      // "SAD HACK" comment in Editor.tsx
      for (let i = 0; i < ast.scopes.length; i++) {
        ast.scopes[i].bindings = renameBindings(
          ast.scopes[i].bindings,
          (name) => {
            if (name === 'iTime') {
              return 'time';
            }
            if (name === 'iMouse') {
              return 'mouse';
            }
            if (name === 'iResolution') {
              return 'renderResolution';
            }
            if (name === 'fragColor') {
              return 'gl_FragColor';
            }
            if (name === 'fragCoord') {
              return 'gl_FragCoord.xy';
            }
            return name;
          }
        );
      }
    },
    nodeInputMap: {},
    edgeMap: {},
  },
  babylon: {
    convertAst: (ast, type) => {
      ast.scopes[0].bindings = renameBindings(ast.scopes[0].bindings, (name) =>
        name === 'vMainUV1' ? 'vUv' : name === 'vNormalW' ? 'vNormal' : name
      );
    },
    nodeInputMap: {},
    edgeMap: {
      bumpSampler: 'normalMap',
    },
  },
};

export default importers;
