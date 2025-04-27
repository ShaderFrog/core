import {
  renameBindings,
  renameFunction,
} from '@shaderfrog/glsl-parser/parser/utils';
import { EngineImporters } from '../../engine';
import { findMainOrThrow, makeStatement } from '../../util/ast';
import { range } from '@editor/util/math';

export const defaultShadertoyVertex = `
precision highp float;
precision highp int;

uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec2 uv2;

varying vec2 vUv;
varying vec3 vPosition;
varying vec3 vNormal;

void main() {
  vUv = uv;
  vPosition = position;
  vNormal = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const importers: EngineImporters = {
  shadertoy: {
    code: {
      defaultShadertoyVertex,
    },
    convertAst: (ast, options) => {
      const isUv = options?.importType === 'uv';
      const isScreen = !isUv;

      if (isScreen) {
        ast.program.unshift(
          makeStatement('uniform vec2 renderResolution', '\n')[0]
        );
      } else {
        ast.program.unshift(makeStatement('varying vec2 vUv', '\n')[0]);
      }

      // These do not catch variables in preprocessor definitions! See "SAD HACK"
      if (ast.scopes.some((s) => 'iTime' in s.bindings)) {
        ast.program.unshift(makeStatement('uniform float time')[0]);
      }
      if (ast.scopes.some((s) => 'iMouse' in s.bindings)) {
        ast.program.unshift(makeStatement('uniform vec2 mouse')[0]);
      }
      range(0, 9).forEach((i) => {
        if (ast.scopes.some((s) => `iChannel${i}` in s.bindings)) {
          ast.program.unshift(
            makeStatement(`uniform sampler2D iChannel${i}`)[0]
          );
        }
      });

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
              if (isUv) {
                return 'vec2(1.0)';
              } else {
                return 'renderResolution';
              }
            }
            if (name === 'fragColor') {
              return 'gl_FragColor';
            }
            if (name === 'fragCoord') {
              if (isUv) {
                return 'vUv';
              } else {
                return 'gl_FragCoord.xy';
              }
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
    convertAst: (ast, options) => {
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
