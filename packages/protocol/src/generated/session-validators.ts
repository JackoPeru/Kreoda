// @ts-nocheck
// Generated from schemas/session-control-v1.json. Do not edit.
// Source SHA256: 93e9e8283b745c4ea77c001d2093ec711161c16ad847705b1c5b194f8fb67ef5
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// node_modules/.pnpm/ajv@8.17.1/node_modules/ajv/dist/runtime/ucs2length.js
var require_ucs2length = __commonJS({
  "node_modules/.pnpm/ajv@8.17.1/node_modules/ajv/dist/runtime/ucs2length.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    function ucs2length(str) {
      const len = str.length;
      let length = 0;
      let pos = 0;
      let value;
      while (pos < len) {
        length++;
        value = str.charCodeAt(pos++);
        if (value >= 55296 && value <= 56319 && pos < len) {
          value = str.charCodeAt(pos);
          if ((value & 64512) === 56320)
            pos++;
        }
      }
      return length;
    }
    exports.default = ucs2length;
    ucs2length.code = 'require("ajv/dist/runtime/ucs2length").default';
  }
});

// session-validators.cjs
var require_session_validators = __commonJS({
  "session-validators.cjs"(exports) {
    exports.StableFeatureId = validate11;
    var func2 = require_ucs2length().default;
    var pattern0 = new RegExp("^[A-Za-z0-9_-]+$", "u");
    function validate11(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (typeof data === "string") {
        if (func2(data) > 128) {
          const err0 = { instancePath, schemaPath: "#/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (func2(data) < 1) {
          const err1 = { instancePath, schemaPath: "#/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (!pattern0.test(data)) {
          const err2 = { instancePath, schemaPath: "#/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_-]+$" }, message: 'must match pattern "^[A-Za-z0-9_-]+$"' };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
      } else {
        const err3 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "string" }, message: "must be string" };
        if (vErrors === null) {
          vErrors = [err3];
        } else {
          vErrors.push(err3);
        }
        errors++;
      }
      validate11.errors = vErrors;
      return errors === 0;
    }
    exports.RequestMetadata = validate12;
    var pattern1 = new RegExp("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", "u");
    function validate12(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.operationId !== void 0) {
          if (data.sessionId === void 0) {
            const err0 = { instancePath, schemaPath: "#/dependencies", keyword: "dependencies", params: {
              property: "operationId",
              missingProperty: "sessionId",
              depsCount: 1,
              deps: "sessionId"
            }, message: "must have property sessionId when property operationId is present" };
            if (vErrors === null) {
              vErrors = [err0];
            } else {
              vErrors.push(err0);
            }
            errors++;
          }
        }
        if (data.operationId !== void 0) {
          let data0 = data.operationId;
          if (typeof data0 === "string") {
            if (!pattern1.test(data0)) {
              const err1 = { instancePath: instancePath + "/operationId", schemaPath: "#/properties/operationId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, message: 'must match pattern "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"' };
              if (vErrors === null) {
                vErrors = [err1];
              } else {
                vErrors.push(err1);
              }
              errors++;
            }
          } else {
            const err2 = { instancePath: instancePath + "/operationId", schemaPath: "#/properties/operationId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        }
        if (data.sessionId !== void 0) {
          let data1 = data.sessionId;
          if (typeof data1 === "string") {
            if (!pattern1.test(data1)) {
              const err3 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, message: 'must match pattern "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"' };
              if (vErrors === null) {
                vErrors = [err3];
              } else {
                vErrors.push(err3);
              }
              errors++;
            }
          } else {
            const err4 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
        }
      } else {
        const err5 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
      validate12.errors = vErrors;
      return errors === 0;
    }
    exports.HelloParams = validate13;
    var schema14 = { "type": "object", "properties": { "token": { "type": "string", "minLength": 1 }, "protocolVersion": { "type": "integer", "enum": [1] }, "clientType": { "type": "string" }, "clientName": { "type": "string" }, "clientId": { "type": "string", "pattern": "^client-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, "capabilities": { "type": "array", "items": { "type": "string", "minLength": 1 } }, "deviceId": { "type": "string", "pattern": "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" } }, "required": ["token", "protocolVersion"], "additionalProperties": true };
    var pattern3 = new RegExp("^client-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$", "u");
    var pattern4 = new RegExp("^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$", "u");
    function validate13(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.token === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "token" }, message: "must have required property 'token'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.protocolVersion === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "protocolVersion" }, message: "must have required property 'protocolVersion'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.token !== void 0) {
          let data0 = data.token;
          if (typeof data0 === "string") {
            if (func2(data0) < 1) {
              const err2 = { instancePath: instancePath + "/token", schemaPath: "#/properties/token/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err2];
              } else {
                vErrors.push(err2);
              }
              errors++;
            }
          } else {
            const err3 = { instancePath: instancePath + "/token", schemaPath: "#/properties/token/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        }
        if (data.protocolVersion !== void 0) {
          let data1 = data.protocolVersion;
          if (!(typeof data1 == "number" && (!(data1 % 1) && !isNaN(data1)) && isFinite(data1))) {
            const err4 = { instancePath: instancePath + "/protocolVersion", schemaPath: "#/properties/protocolVersion/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
          if (!(data1 === 1)) {
            const err5 = { instancePath: instancePath + "/protocolVersion", schemaPath: "#/properties/protocolVersion/enum", keyword: "enum", params: { allowedValues: schema14.properties.protocolVersion.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        }
        if (data.clientType !== void 0) {
          if (typeof data.clientType !== "string") {
            const err6 = { instancePath: instancePath + "/clientType", schemaPath: "#/properties/clientType/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err6];
            } else {
              vErrors.push(err6);
            }
            errors++;
          }
        }
        if (data.clientName !== void 0) {
          if (typeof data.clientName !== "string") {
            const err7 = { instancePath: instancePath + "/clientName", schemaPath: "#/properties/clientName/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
        }
        if (data.clientId !== void 0) {
          let data4 = data.clientId;
          if (typeof data4 === "string") {
            if (!pattern3.test(data4)) {
              const err8 = { instancePath: instancePath + "/clientId", schemaPath: "#/properties/clientId/pattern", keyword: "pattern", params: { pattern: "^client-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, message: 'must match pattern "^client-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"' };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
          } else {
            const err9 = { instancePath: instancePath + "/clientId", schemaPath: "#/properties/clientId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        if (data.capabilities !== void 0) {
          let data5 = data.capabilities;
          if (Array.isArray(data5)) {
            const len0 = data5.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data6 = data5[i0];
              if (typeof data6 === "string") {
                if (func2(data6) < 1) {
                  const err10 = { instancePath: instancePath + "/capabilities/" + i0, schemaPath: "#/properties/capabilities/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err10];
                  } else {
                    vErrors.push(err10);
                  }
                  errors++;
                }
              } else {
                const err11 = { instancePath: instancePath + "/capabilities/" + i0, schemaPath: "#/properties/capabilities/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err11];
                } else {
                  vErrors.push(err11);
                }
                errors++;
              }
            }
          } else {
            const err12 = { instancePath: instancePath + "/capabilities", schemaPath: "#/properties/capabilities/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        }
        if (data.deviceId !== void 0) {
          let data7 = data.deviceId;
          if (typeof data7 === "string") {
            if (!pattern4.test(data7)) {
              const err13 = { instancePath: instancePath + "/deviceId", schemaPath: "#/properties/deviceId/pattern", keyword: "pattern", params: { pattern: "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" }, message: 'must match pattern "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"' };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
          } else {
            const err14 = { instancePath: instancePath + "/deviceId", schemaPath: "#/properties/deviceId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
        }
      } else {
        const err15 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err15];
        } else {
          vErrors.push(err15);
        }
        errors++;
      }
      validate13.errors = vErrors;
      return errors === 0;
    }
    exports.SnapshotParams = validate14;
    function validate14(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.documentId !== void 0) {
          let data0 = data.documentId;
          if (typeof data0 === "string") {
            if (func2(data0) < 1) {
              const err0 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err0];
              } else {
                vErrors.push(err0);
              }
              errors++;
            }
          } else {
            const err1 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err1];
            } else {
              vErrors.push(err1);
            }
            errors++;
          }
        }
      } else {
        const err2 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err2];
        } else {
          vErrors.push(err2);
        }
        errors++;
      }
      validate14.errors = vErrors;
      return errors === 0;
    }
    exports.InvokeParams = validate15;
    function validate15(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.type === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.type !== void 0) {
          let data0 = data.type;
          if (!(typeof data0 == "number" && (!(data0 % 1) && !isNaN(data0)) && isFinite(data0))) {
            const err1 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err1];
            } else {
              vErrors.push(err1);
            }
            errors++;
          }
        }
        if (data.fields !== void 0) {
          let data1 = data.fields;
          if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
          } else {
            const err2 = { instancePath: instancePath + "/fields", schemaPath: "#/properties/fields/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        }
        if (data.documentId !== void 0) {
          let data2 = data.documentId;
          if (typeof data2 === "string") {
            if (func2(data2) < 1) {
              const err3 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err3];
              } else {
                vErrors.push(err3);
              }
              errors++;
            }
          } else {
            const err4 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
        }
        if (data.baseRevision !== void 0) {
          let data3 = data.baseRevision;
          const _errs10 = errors;
          let valid1 = false;
          const _errs11 = errors;
          if (!(typeof data3 == "number" && (!(data3 % 1) && !isNaN(data3)) && isFinite(data3))) {
            const err5 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/anyOf/0/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
          if (typeof data3 == "number" && isFinite(data3)) {
            if (data3 > 9007199254740991 || isNaN(data3)) {
              const err6 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/anyOf/0/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
              if (vErrors === null) {
                vErrors = [err6];
              } else {
                vErrors.push(err6);
              }
              errors++;
            }
            if (data3 < 0 || isNaN(data3)) {
              const err7 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/anyOf/0/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
          }
          var _valid0 = _errs11 === errors;
          valid1 = valid1 || _valid0;
          if (!valid1) {
            const _errs13 = errors;
            if (data3 !== null) {
              const err8 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
            var _valid0 = _errs13 === errors;
            valid1 = valid1 || _valid0;
          }
          if (!valid1) {
            const err9 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          } else {
            errors = _errs10;
            if (vErrors !== null) {
              if (_errs10) {
                vErrors.length = _errs10;
              } else {
                vErrors = null;
              }
            }
          }
        }
        if (data.transactionId !== void 0) {
          let data4 = data.transactionId;
          if (typeof data4 === "string") {
            if (func2(data4) < 1) {
              const err10 = { instancePath: instancePath + "/transactionId", schemaPath: "#/properties/transactionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
          } else {
            const err11 = { instancePath: instancePath + "/transactionId", schemaPath: "#/properties/transactionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err11];
            } else {
              vErrors.push(err11);
            }
            errors++;
          }
        }
      } else {
        const err12 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      validate15.errors = vErrors;
      return errors === 0;
    }
    exports.NamedCommandParams = validate16;
    function validate16(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.commandId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "commandId" }, message: "must have required property 'commandId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.commandId !== void 0) {
          let data0 = data.commandId;
          if (typeof data0 === "string") {
            if (func2(data0) < 1) {
              const err1 = { instancePath: instancePath + "/commandId", schemaPath: "#/properties/commandId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err1];
              } else {
                vErrors.push(err1);
              }
              errors++;
            }
          } else {
            const err2 = { instancePath: instancePath + "/commandId", schemaPath: "#/properties/commandId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        }
        if (data.parameters !== void 0) {
          let data1 = data.parameters;
          if (data1 && typeof data1 == "object" && !Array.isArray(data1)) {
          } else {
            const err3 = { instancePath: instancePath + "/parameters", schemaPath: "#/properties/parameters/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        }
        if (data.featureId !== void 0) {
          let data2 = data.featureId;
          if (typeof data2 === "string") {
            if (func2(data2) > 128) {
              const err4 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err4];
              } else {
                vErrors.push(err4);
              }
              errors++;
            }
            if (func2(data2) < 1) {
              const err5 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
            if (!pattern0.test(data2)) {
              const err6 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_-]+$" }, message: 'must match pattern "^[A-Za-z0-9_-]+$"' };
              if (vErrors === null) {
                vErrors = [err6];
              } else {
                vErrors.push(err6);
              }
              errors++;
            }
          } else {
            const err7 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
        }
        if (data.documentId !== void 0) {
          let data3 = data.documentId;
          if (typeof data3 === "string") {
            if (func2(data3) < 1) {
              const err8 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
          } else {
            const err9 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        if (data.baseRevision !== void 0) {
          let data4 = data.baseRevision;
          const _errs13 = errors;
          let valid2 = false;
          const _errs14 = errors;
          if (!(typeof data4 == "number" && (!(data4 % 1) && !isNaN(data4)) && isFinite(data4))) {
            const err10 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/anyOf/0/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
            }
            errors++;
          }
          if (typeof data4 == "number" && isFinite(data4)) {
            if (data4 > 9007199254740991 || isNaN(data4)) {
              const err11 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/anyOf/0/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
              if (vErrors === null) {
                vErrors = [err11];
              } else {
                vErrors.push(err11);
              }
              errors++;
            }
            if (data4 < 0 || isNaN(data4)) {
              const err12 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/anyOf/0/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err12];
              } else {
                vErrors.push(err12);
              }
              errors++;
            }
          }
          var _valid0 = _errs14 === errors;
          valid2 = valid2 || _valid0;
          if (!valid2) {
            const _errs16 = errors;
            if (data4 !== null) {
              const err13 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/anyOf/1/type", keyword: "type", params: { type: "null" }, message: "must be null" };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
            var _valid0 = _errs16 === errors;
            valid2 = valid2 || _valid0;
          }
          if (!valid2) {
            const err14 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/anyOf", keyword: "anyOf", params: {}, message: "must match a schema in anyOf" };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          } else {
            errors = _errs13;
            if (vErrors !== null) {
              if (_errs13) {
                vErrors.length = _errs13;
              } else {
                vErrors = null;
              }
            }
          }
        }
        if (data.transactionId !== void 0) {
          let data5 = data.transactionId;
          if (typeof data5 === "string") {
            if (func2(data5) < 1) {
              const err15 = { instancePath: instancePath + "/transactionId", schemaPath: "#/properties/transactionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err15];
              } else {
                vErrors.push(err15);
              }
              errors++;
            }
          } else {
            const err16 = { instancePath: instancePath + "/transactionId", schemaPath: "#/properties/transactionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
        }
      } else {
        const err17 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
      validate16.errors = vErrors;
      return errors === 0;
    }
    exports.TxnParams = validate17;
    function validate17(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.transactionId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "transactionId" }, message: "must have required property 'transactionId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.transactionId !== void 0) {
          let data0 = data.transactionId;
          if (typeof data0 === "string") {
            if (func2(data0) < 1) {
              const err1 = { instancePath: instancePath + "/transactionId", schemaPath: "#/properties/transactionId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err1];
              } else {
                vErrors.push(err1);
              }
              errors++;
            }
          } else {
            const err2 = { instancePath: instancePath + "/transactionId", schemaPath: "#/properties/transactionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        }
        if (data.documentId !== void 0) {
          let data1 = data.documentId;
          if (typeof data1 === "string") {
            if (func2(data1) < 1) {
              const err3 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err3];
              } else {
                vErrors.push(err3);
              }
              errors++;
            }
          } else {
            const err4 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
        }
      } else {
        const err5 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err5];
        } else {
          vErrors.push(err5);
        }
        errors++;
      }
      validate17.errors = vErrors;
      return errors === 0;
    }
    exports.ErrorReply = validate18;
    var schema20 = { "type": "object", "properties": { "requestId": { "type": "string", "minLength": 1 }, "ok": { "type": "boolean", "enum": [false] }, "errorCode": { "type": "string", "minLength": 1 }, "error": { "type": "string", "minLength": 1 } }, "required": ["requestId", "ok", "errorCode", "error"], "additionalProperties": true };
    function validate18(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.requestId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "requestId" }, message: "must have required property 'requestId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.ok === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.errorCode === void 0) {
          const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "errorCode" }, message: "must have required property 'errorCode'" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (data.error === void 0) {
          const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "error" }, message: "must have required property 'error'" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
        if (data.requestId !== void 0) {
          let data0 = data.requestId;
          if (typeof data0 === "string") {
            if (func2(data0) < 1) {
              const err4 = { instancePath: instancePath + "/requestId", schemaPath: "#/properties/requestId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err4];
              } else {
                vErrors.push(err4);
              }
              errors++;
            }
          } else {
            const err5 = { instancePath: instancePath + "/requestId", schemaPath: "#/properties/requestId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        }
        if (data.ok !== void 0) {
          let data1 = data.ok;
          if (typeof data1 !== "boolean") {
            const err6 = { instancePath: instancePath + "/ok", schemaPath: "#/properties/ok/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err6];
            } else {
              vErrors.push(err6);
            }
            errors++;
          }
          if (!(data1 === false)) {
            const err7 = { instancePath: instancePath + "/ok", schemaPath: "#/properties/ok/enum", keyword: "enum", params: { allowedValues: schema20.properties.ok.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
        }
        if (data.errorCode !== void 0) {
          let data2 = data.errorCode;
          if (typeof data2 === "string") {
            if (func2(data2) < 1) {
              const err8 = { instancePath: instancePath + "/errorCode", schemaPath: "#/properties/errorCode/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
          } else {
            const err9 = { instancePath: instancePath + "/errorCode", schemaPath: "#/properties/errorCode/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        if (data.error !== void 0) {
          let data3 = data.error;
          if (typeof data3 === "string") {
            if (func2(data3) < 1) {
              const err10 = { instancePath: instancePath + "/error", schemaPath: "#/properties/error/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
          } else {
            const err11 = { instancePath: instancePath + "/error", schemaPath: "#/properties/error/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err11];
            } else {
              vErrors.push(err11);
            }
            errors++;
          }
        }
      } else {
        const err12 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      validate18.errors = vErrors;
      return errors === 0;
    }
    exports.SessionRequestEnvelope = validate19;
    function validate19(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.requestId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "requestId" }, message: "must have required property 'requestId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.method === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "method" }, message: "must have required property 'method'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.operationId !== void 0) {
          if (data.sessionId === void 0) {
            const err2 = { instancePath, schemaPath: "#/dependencies", keyword: "dependencies", params: {
              property: "operationId",
              missingProperty: "sessionId",
              depsCount: 1,
              deps: "sessionId"
            }, message: "must have property sessionId when property operationId is present" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
        }
        if (data.requestId !== void 0) {
          let data0 = data.requestId;
          if (typeof data0 === "string") {
            if (func2(data0) < 1) {
              const err3 = { instancePath: instancePath + "/requestId", schemaPath: "#/properties/requestId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err3];
              } else {
                vErrors.push(err3);
              }
              errors++;
            }
          } else {
            const err4 = { instancePath: instancePath + "/requestId", schemaPath: "#/properties/requestId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
        }
        if (data.method !== void 0) {
          let data1 = data.method;
          if (typeof data1 === "string") {
            if (func2(data1) < 1) {
              const err5 = { instancePath: instancePath + "/method", schemaPath: "#/properties/method/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
          } else {
            const err6 = { instancePath: instancePath + "/method", schemaPath: "#/properties/method/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err6];
            } else {
              vErrors.push(err6);
            }
            errors++;
          }
        }
        if (data.params !== void 0) {
          let data2 = data.params;
          if (data2 && typeof data2 == "object" && !Array.isArray(data2)) {
          } else {
            const err7 = { instancePath: instancePath + "/params", schemaPath: "#/properties/params/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
        }
        if (data.operationId !== void 0) {
          let data3 = data.operationId;
          if (typeof data3 === "string") {
            if (!pattern1.test(data3)) {
              const err8 = { instancePath: instancePath + "/operationId", schemaPath: "#/properties/operationId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, message: 'must match pattern "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"' };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
          } else {
            const err9 = { instancePath: instancePath + "/operationId", schemaPath: "#/properties/operationId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        if (data.sessionId !== void 0) {
          let data4 = data.sessionId;
          if (typeof data4 === "string") {
            if (!pattern1.test(data4)) {
              const err10 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, message: 'must match pattern "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"' };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
          } else {
            const err11 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err11];
            } else {
              vErrors.push(err11);
            }
            errors++;
          }
        }
      } else {
        const err12 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      validate19.errors = vErrors;
      return errors === 0;
    }
    exports.HelloReply = validate20;
    var schema22 = { "type": "object", "properties": { "requestId": { "type": "string", "minLength": 1 }, "ok": { "type": "boolean", "enum": [true] }, "clientId": { "type": "string", "minLength": 1 }, "sessionId": { "type": "string", "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, "documentId": { "type": "string", "minLength": 1 }, "revision": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }, "capabilities": { "type": "array", "items": { "type": "string", "minLength": 1 } }, "deviceId": { "type": "string", "pattern": "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" } }, "required": ["requestId", "ok", "clientId", "sessionId", "documentId", "revision", "capabilities"], "additionalProperties": true };
    function validate20(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.requestId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "requestId" }, message: "must have required property 'requestId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.ok === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "ok" }, message: "must have required property 'ok'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.clientId === void 0) {
          const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "clientId" }, message: "must have required property 'clientId'" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (data.sessionId === void 0) {
          const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sessionId" }, message: "must have required property 'sessionId'" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
        if (data.documentId === void 0) {
          const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "documentId" }, message: "must have required property 'documentId'" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
        if (data.revision === void 0) {
          const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "revision" }, message: "must have required property 'revision'" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
        if (data.capabilities === void 0) {
          const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "capabilities" }, message: "must have required property 'capabilities'" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (data.requestId !== void 0) {
          let data0 = data.requestId;
          if (typeof data0 === "string") {
            if (func2(data0) < 1) {
              const err7 = { instancePath: instancePath + "/requestId", schemaPath: "#/properties/requestId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
          } else {
            const err8 = { instancePath: instancePath + "/requestId", schemaPath: "#/properties/requestId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
        if (data.ok !== void 0) {
          let data1 = data.ok;
          if (typeof data1 !== "boolean") {
            const err9 = { instancePath: instancePath + "/ok", schemaPath: "#/properties/ok/type", keyword: "type", params: { type: "boolean" }, message: "must be boolean" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
          if (!(data1 === true)) {
            const err10 = { instancePath: instancePath + "/ok", schemaPath: "#/properties/ok/enum", keyword: "enum", params: { allowedValues: schema22.properties.ok.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
            }
            errors++;
          }
        }
        if (data.clientId !== void 0) {
          let data2 = data.clientId;
          if (typeof data2 === "string") {
            if (func2(data2) < 1) {
              const err11 = { instancePath: instancePath + "/clientId", schemaPath: "#/properties/clientId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err11];
              } else {
                vErrors.push(err11);
              }
              errors++;
            }
          } else {
            const err12 = { instancePath: instancePath + "/clientId", schemaPath: "#/properties/clientId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        }
        if (data.sessionId !== void 0) {
          let data3 = data.sessionId;
          if (typeof data3 === "string") {
            if (!pattern1.test(data3)) {
              const err13 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, message: 'must match pattern "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"' };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
          } else {
            const err14 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
        }
        if (data.documentId !== void 0) {
          let data4 = data.documentId;
          if (typeof data4 === "string") {
            if (func2(data4) < 1) {
              const err15 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err15];
              } else {
                vErrors.push(err15);
              }
              errors++;
            }
          } else {
            const err16 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
        }
        if (data.revision !== void 0) {
          let data5 = data.revision;
          if (!(typeof data5 == "number" && (!(data5 % 1) && !isNaN(data5)) && isFinite(data5))) {
            const err17 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err17];
            } else {
              vErrors.push(err17);
            }
            errors++;
          }
          if (typeof data5 == "number" && isFinite(data5)) {
            if (data5 > 9007199254740991 || isNaN(data5)) {
              const err18 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
              if (vErrors === null) {
                vErrors = [err18];
              } else {
                vErrors.push(err18);
              }
              errors++;
            }
            if (data5 < 0 || isNaN(data5)) {
              const err19 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err19];
              } else {
                vErrors.push(err19);
              }
              errors++;
            }
          }
        }
        if (data.capabilities !== void 0) {
          let data6 = data.capabilities;
          if (Array.isArray(data6)) {
            const len0 = data6.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data7 = data6[i0];
              if (typeof data7 === "string") {
                if (func2(data7) < 1) {
                  const err20 = { instancePath: instancePath + "/capabilities/" + i0, schemaPath: "#/properties/capabilities/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err20];
                  } else {
                    vErrors.push(err20);
                  }
                  errors++;
                }
              } else {
                const err21 = { instancePath: instancePath + "/capabilities/" + i0, schemaPath: "#/properties/capabilities/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err21];
                } else {
                  vErrors.push(err21);
                }
                errors++;
              }
            }
          } else {
            const err22 = { instancePath: instancePath + "/capabilities", schemaPath: "#/properties/capabilities/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
        }
        if (data.deviceId !== void 0) {
          let data8 = data.deviceId;
          if (typeof data8 === "string") {
            if (!pattern4.test(data8)) {
              const err23 = { instancePath: instancePath + "/deviceId", schemaPath: "#/properties/deviceId/pattern", keyword: "pattern", params: { pattern: "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" }, message: 'must match pattern "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"' };
              if (vErrors === null) {
                vErrors = [err23];
              } else {
                vErrors.push(err23);
              }
              errors++;
            }
          } else {
            const err24 = { instancePath: instancePath + "/deviceId", schemaPath: "#/properties/deviceId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err24];
            } else {
              vErrors.push(err24);
            }
            errors++;
          }
        }
      } else {
        const err25 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err25];
        } else {
          vErrors.push(err25);
        }
        errors++;
      }
      validate20.errors = vErrors;
      return errors === 0;
    }
    exports.FeatureDescriptor = validate21;
    function validate21(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.featureId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "featureId" }, message: "must have required property 'featureId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.type === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "type" }, message: "must have required property 'type'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.featureId !== void 0) {
          let data0 = data.featureId;
          if (typeof data0 === "string") {
            if (func2(data0) > 128) {
              const err2 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err2];
              } else {
                vErrors.push(err2);
              }
              errors++;
            }
            if (func2(data0) < 1) {
              const err3 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err3];
              } else {
                vErrors.push(err3);
              }
              errors++;
            }
            if (!pattern0.test(data0)) {
              const err4 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_-]+$" }, message: 'must match pattern "^[A-Za-z0-9_-]+$"' };
              if (vErrors === null) {
                vErrors = [err4];
              } else {
                vErrors.push(err4);
              }
              errors++;
            }
          } else {
            const err5 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        }
        if (data.type !== void 0) {
          let data1 = data.type;
          if (typeof data1 === "string") {
            if (func2(data1) < 1) {
              const err6 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err6];
              } else {
                vErrors.push(err6);
              }
              errors++;
            }
          } else {
            const err7 = { instancePath: instancePath + "/type", schemaPath: "#/properties/type/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
        }
        if (data.paramsMm !== void 0) {
          let data2 = data.paramsMm;
          if (Array.isArray(data2)) {
            const len0 = data2.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data3 = data2[i0];
              if (!(typeof data3 == "number" && isFinite(data3))) {
                const err8 = { instancePath: instancePath + "/paramsMm/" + i0, schemaPath: "#/properties/paramsMm/items/type", keyword: "type", params: { type: "number" }, message: "must be number" };
                if (vErrors === null) {
                  vErrors = [err8];
                } else {
                  vErrors.push(err8);
                }
                errors++;
              }
            }
          } else {
            const err9 = { instancePath: instancePath + "/paramsMm", schemaPath: "#/properties/paramsMm/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        if (data.volumeMm3 !== void 0) {
          let data4 = data.volumeMm3;
          if (!(typeof data4 == "number" && isFinite(data4))) {
            const err10 = { instancePath: instancePath + "/volumeMm3", schemaPath: "#/properties/volumeMm3/type", keyword: "type", params: { type: "number" }, message: "must be number" };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
            }
            errors++;
          }
        }
        if (data.dependsOn !== void 0) {
          let data5 = data.dependsOn;
          if (Array.isArray(data5)) {
            const len1 = data5.length;
            for (let i1 = 0; i1 < len1; i1++) {
              let data6 = data5[i1];
              if (typeof data6 === "string") {
                if (func2(data6) < 1) {
                  const err11 = { instancePath: instancePath + "/dependsOn/" + i1, schemaPath: "#/properties/dependsOn/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err11];
                  } else {
                    vErrors.push(err11);
                  }
                  errors++;
                }
              } else {
                const err12 = { instancePath: instancePath + "/dependsOn/" + i1, schemaPath: "#/properties/dependsOn/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err12];
                } else {
                  vErrors.push(err12);
                }
                errors++;
              }
            }
          } else {
            const err13 = { instancePath: instancePath + "/dependsOn", schemaPath: "#/properties/dependsOn/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err13];
            } else {
              vErrors.push(err13);
            }
            errors++;
          }
        }
        if (data.refExtra !== void 0) {
          if (typeof data.refExtra !== "string") {
            const err14 = { instancePath: instancePath + "/refExtra", schemaPath: "#/properties/refExtra/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
        }
        if (data.expressions !== void 0) {
          let data8 = data.expressions;
          if (data8 && typeof data8 == "object" && !Array.isArray(data8)) {
            for (const key0 in data8) {
              if (typeof data8[key0] !== "string") {
                const err15 = { instancePath: instancePath + "/expressions/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"), schemaPath: "#/properties/expressions/additionalProperties/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err15];
                } else {
                  vErrors.push(err15);
                }
                errors++;
              }
            }
          } else {
            const err16 = { instancePath: instancePath + "/expressions", schemaPath: "#/properties/expressions/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
        }
      } else {
        const err17 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err17];
        } else {
          vErrors.push(err17);
        }
        errors++;
      }
      validate21.errors = vErrors;
      return errors === 0;
    }
    exports.SketchDescriptor = validate22;
    function validate22(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.featureId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "featureId" }, message: "must have required property 'featureId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.featureId !== void 0) {
          let data0 = data.featureId;
          if (typeof data0 === "string") {
            if (func2(data0) > 128) {
              const err1 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err1];
              } else {
                vErrors.push(err1);
              }
              errors++;
            }
            if (func2(data0) < 1) {
              const err2 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err2];
              } else {
                vErrors.push(err2);
              }
              errors++;
            }
            if (!pattern0.test(data0)) {
              const err3 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_-]+$" }, message: 'must match pattern "^[A-Za-z0-9_-]+$"' };
              if (vErrors === null) {
                vErrors = [err3];
              } else {
                vErrors.push(err3);
              }
              errors++;
            }
          } else {
            const err4 = { instancePath: instancePath + "/featureId", schemaPath: "#/definitions/StableFeatureId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
        }
        if (data.id !== void 0) {
          let data1 = data.id;
          if (typeof data1 === "string") {
            if (func2(data1) > 128) {
              const err5 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/StableFeatureId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
            if (func2(data1) < 1) {
              const err6 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/StableFeatureId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err6];
              } else {
                vErrors.push(err6);
              }
              errors++;
            }
            if (!pattern0.test(data1)) {
              const err7 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/StableFeatureId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_-]+$" }, message: 'must match pattern "^[A-Za-z0-9_-]+$"' };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
          } else {
            const err8 = { instancePath: instancePath + "/id", schemaPath: "#/definitions/StableFeatureId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
        if (data.planeKind !== void 0) {
          let data2 = data.planeKind;
          if (typeof data2 === "string") {
            if (func2(data2) < 1) {
              const err9 = { instancePath: instancePath + "/planeKind", schemaPath: "#/properties/planeKind/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err9];
              } else {
                vErrors.push(err9);
              }
              errors++;
            }
          } else {
            const err10 = { instancePath: instancePath + "/planeKind", schemaPath: "#/properties/planeKind/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
            }
            errors++;
          }
        }
        if (data.plane !== void 0) {
          let data3 = data.plane;
          if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
          } else {
            const err11 = { instancePath: instancePath + "/plane", schemaPath: "#/properties/plane/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err11];
            } else {
              vErrors.push(err11);
            }
            errors++;
          }
        }
        if (data.supportRef !== void 0) {
          if (typeof data.supportRef !== "string") {
            const err12 = { instancePath: instancePath + "/supportRef", schemaPath: "#/properties/supportRef/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        }
        if (data.model !== void 0) {
          let data5 = data.model;
          if (data5 && typeof data5 == "object" && !Array.isArray(data5)) {
          } else {
            const err13 = { instancePath: instancePath + "/model", schemaPath: "#/properties/model/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err13];
            } else {
              vErrors.push(err13);
            }
            errors++;
          }
        }
      } else {
        const err14 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err14];
        } else {
          vErrors.push(err14);
        }
        errors++;
      }
      validate22.errors = vErrors;
      return errors === 0;
    }
    exports.BodyDescriptor = validate23;
    function validate23(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.bodyId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "bodyId" }, message: "must have required property 'bodyId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.tip === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "tip" }, message: "must have required property 'tip'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.history === void 0) {
          const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "history" }, message: "must have required property 'history'" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (data.bodyId !== void 0) {
          let data0 = data.bodyId;
          if (typeof data0 === "string") {
            if (func2(data0) < 1) {
              const err3 = { instancePath: instancePath + "/bodyId", schemaPath: "#/properties/bodyId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err3];
              } else {
                vErrors.push(err3);
              }
              errors++;
            }
          } else {
            const err4 = { instancePath: instancePath + "/bodyId", schemaPath: "#/properties/bodyId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
        }
        if (data.tip !== void 0) {
          let data1 = data.tip;
          if (typeof data1 === "string") {
            if (func2(data1) > 128) {
              const err5 = { instancePath: instancePath + "/tip", schemaPath: "#/definitions/StableFeatureId/maxLength", keyword: "maxLength", params: { limit: 128 }, message: "must NOT have more than 128 characters" };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
            if (func2(data1) < 1) {
              const err6 = { instancePath: instancePath + "/tip", schemaPath: "#/definitions/StableFeatureId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err6];
              } else {
                vErrors.push(err6);
              }
              errors++;
            }
            if (!pattern0.test(data1)) {
              const err7 = { instancePath: instancePath + "/tip", schemaPath: "#/definitions/StableFeatureId/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_-]+$" }, message: 'must match pattern "^[A-Za-z0-9_-]+$"' };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
          } else {
            const err8 = { instancePath: instancePath + "/tip", schemaPath: "#/definitions/StableFeatureId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
        if (data.history !== void 0) {
          let data2 = data.history;
          if (Array.isArray(data2)) {
            const len0 = data2.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data3 = data2[i0];
              if (typeof data3 === "string") {
                if (func2(data3) < 1) {
                  const err9 = { instancePath: instancePath + "/history/" + i0, schemaPath: "#/properties/history/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err9];
                  } else {
                    vErrors.push(err9);
                  }
                  errors++;
                }
              } else {
                const err10 = { instancePath: instancePath + "/history/" + i0, schemaPath: "#/properties/history/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err10];
                } else {
                  vErrors.push(err10);
                }
                errors++;
              }
            }
          } else {
            const err11 = { instancePath: instancePath + "/history", schemaPath: "#/properties/history/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err11];
            } else {
              vErrors.push(err11);
            }
            errors++;
          }
        }
      } else {
        const err12 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err12];
        } else {
          vErrors.push(err12);
        }
        errors++;
      }
      validate23.errors = vErrors;
      return errors === 0;
    }
    exports.SessionSnapshotPayload = validate24;
    function validate24(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.sessionId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sessionId" }, message: "must have required property 'sessionId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.documentId === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "documentId" }, message: "must have required property 'documentId'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.revision === void 0) {
          const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "revision" }, message: "must have required property 'revision'" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (data.features === void 0) {
          const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "features" }, message: "must have required property 'features'" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
        if (data.sketches === void 0) {
          const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sketches" }, message: "must have required property 'sketches'" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
        if (data.bodies === void 0) {
          const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "bodies" }, message: "must have required property 'bodies'" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
        if (data.sessionId !== void 0) {
          let data0 = data.sessionId;
          if (typeof data0 === "string") {
            if (!pattern1.test(data0)) {
              const err6 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, message: 'must match pattern "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"' };
              if (vErrors === null) {
                vErrors = [err6];
              } else {
                vErrors.push(err6);
              }
              errors++;
            }
          } else {
            const err7 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
        }
        if (data.documentId !== void 0) {
          let data1 = data.documentId;
          if (typeof data1 === "string") {
            if (func2(data1) < 1) {
              const err8 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err8];
              } else {
                vErrors.push(err8);
              }
              errors++;
            }
          } else {
            const err9 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
        if (data.revision !== void 0) {
          let data2 = data.revision;
          if (!(typeof data2 == "number" && (!(data2 % 1) && !isNaN(data2)) && isFinite(data2))) {
            const err10 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
            }
            errors++;
          }
          if (typeof data2 == "number" && isFinite(data2)) {
            if (data2 > 9007199254740991 || isNaN(data2)) {
              const err11 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
              if (vErrors === null) {
                vErrors = [err11];
              } else {
                vErrors.push(err11);
              }
              errors++;
            }
            if (data2 < 0 || isNaN(data2)) {
              const err12 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err12];
              } else {
                vErrors.push(err12);
              }
              errors++;
            }
          }
        }
        if (data.features !== void 0) {
          let data3 = data.features;
          if (Array.isArray(data3)) {
            const len0 = data3.length;
            for (let i0 = 0; i0 < len0; i0++) {
              if (!validate21(data3[i0], { instancePath: instancePath + "/features/" + i0, parentData: data3, parentDataProperty: i0, rootData })) {
                vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
                errors = vErrors.length;
              }
            }
          } else {
            const err13 = { instancePath: instancePath + "/features", schemaPath: "#/properties/features/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err13];
            } else {
              vErrors.push(err13);
            }
            errors++;
          }
        }
        if (data.sketches !== void 0) {
          let data5 = data.sketches;
          if (Array.isArray(data5)) {
            const len1 = data5.length;
            for (let i1 = 0; i1 < len1; i1++) {
              if (!validate22(data5[i1], { instancePath: instancePath + "/sketches/" + i1, parentData: data5, parentDataProperty: i1, rootData })) {
                vErrors = vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
                errors = vErrors.length;
              }
            }
          } else {
            const err14 = { instancePath: instancePath + "/sketches", schemaPath: "#/properties/sketches/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
        }
        if (data.bodies !== void 0) {
          let data7 = data.bodies;
          if (Array.isArray(data7)) {
            const len2 = data7.length;
            for (let i2 = 0; i2 < len2; i2++) {
              if (!validate23(data7[i2], { instancePath: instancePath + "/bodies/" + i2, parentData: data7, parentDataProperty: i2, rootData })) {
                vErrors = vErrors === null ? validate23.errors : vErrors.concat(validate23.errors);
                errors = vErrors.length;
              }
            }
          } else {
            const err15 = { instancePath: instancePath + "/bodies", schemaPath: "#/properties/bodies/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err15];
            } else {
              vErrors.push(err15);
            }
            errors++;
          }
        }
        if (data.tips !== void 0) {
          let data9 = data.tips;
          if (Array.isArray(data9)) {
            const len3 = data9.length;
            for (let i3 = 0; i3 < len3; i3++) {
              let data10 = data9[i3];
              if (typeof data10 === "string") {
                if (func2(data10) < 1) {
                  const err16 = { instancePath: instancePath + "/tips/" + i3, schemaPath: "#/properties/tips/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err16];
                  } else {
                    vErrors.push(err16);
                  }
                  errors++;
                }
              } else {
                const err17 = { instancePath: instancePath + "/tips/" + i3, schemaPath: "#/properties/tips/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err17];
                } else {
                  vErrors.push(err17);
                }
                errors++;
              }
            }
          } else {
            const err18 = { instancePath: instancePath + "/tips", schemaPath: "#/properties/tips/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err18];
            } else {
              vErrors.push(err18);
            }
            errors++;
          }
        }
      } else {
        const err19 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err19];
        } else {
          vErrors.push(err19);
        }
        errors++;
      }
      validate24.errors = vErrors;
      return errors === 0;
    }
    exports.SessionEntityPatch = validate28;
    var schema31 = { "type": "object", "properties": { "kind": { "type": "string", "enum": ["feature", "sketch", "body"] }, "id": { "type": "string", "minLength": 1 }, "index": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }, "value": { "type": "object", "additionalProperties": true } }, "required": ["kind", "id", "index", "value"], "additionalProperties": false };
    function validate28(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.kind === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.id === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.index === void 0) {
          const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "index" }, message: "must have required property 'index'" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (data.value === void 0) {
          const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
        for (const key0 in data) {
          if (!(key0 === "kind" || key0 === "id" || key0 === "index" || key0 === "value")) {
            const err4 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
        }
        if (data.kind !== void 0) {
          let data0 = data.kind;
          if (typeof data0 !== "string") {
            const err5 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
          if (!(data0 === "feature" || data0 === "sketch" || data0 === "body")) {
            const err6 = { instancePath: instancePath + "/kind", schemaPath: "#/properties/kind/enum", keyword: "enum", params: { allowedValues: schema31.properties.kind.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err6];
            } else {
              vErrors.push(err6);
            }
            errors++;
          }
        }
        if (data.id !== void 0) {
          let data1 = data.id;
          if (typeof data1 === "string") {
            if (func2(data1) < 1) {
              const err7 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
          } else {
            const err8 = { instancePath: instancePath + "/id", schemaPath: "#/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
        if (data.index !== void 0) {
          let data2 = data.index;
          if (!(typeof data2 == "number" && (!(data2 % 1) && !isNaN(data2)) && isFinite(data2))) {
            const err9 = { instancePath: instancePath + "/index", schemaPath: "#/properties/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
          if (typeof data2 == "number" && isFinite(data2)) {
            if (data2 > 9007199254740991 || isNaN(data2)) {
              const err10 = { instancePath: instancePath + "/index", schemaPath: "#/properties/index/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
              if (vErrors === null) {
                vErrors = [err10];
              } else {
                vErrors.push(err10);
              }
              errors++;
            }
            if (data2 < 0 || isNaN(data2)) {
              const err11 = { instancePath: instancePath + "/index", schemaPath: "#/properties/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err11];
              } else {
                vErrors.push(err11);
              }
              errors++;
            }
          }
        }
        if (data.value !== void 0) {
          let data3 = data.value;
          if (data3 && typeof data3 == "object" && !Array.isArray(data3)) {
          } else {
            const err12 = { instancePath: instancePath + "/value", schemaPath: "#/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
            if (vErrors === null) {
              vErrors = [err12];
            } else {
              vErrors.push(err12);
            }
            errors++;
          }
        }
      } else {
        const err13 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err13];
        } else {
          vErrors.push(err13);
        }
        errors++;
      }
      validate28.errors = vErrors;
      return errors === 0;
    }
    exports.SessionIncrementalEvent = validate29;
    var schema32 = { "type": "object", "properties": { "event": { "type": "string", "enum": ["delta"] }, "baseRevision": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }, "newRevision": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }, "revision": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }, "sessionId": { "type": "string", "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, "documentId": { "type": "string", "minLength": 1 }, "originClientId": { "type": "string", "minLength": 1 }, "added": { "type": "array", "items": { "$ref": "#/definitions/SessionEntityPatch" } }, "updated": { "type": "array", "items": { "$ref": "#/definitions/SessionEntityPatch" } }, "removedIds": { "type": "array", "items": { "type": "string", "minLength": 1 } }, "changedMeshIds": { "type": "array", "items": { "type": "string", "minLength": 1 } }, "referenceRemaps": { "type": "array", "items": {} }, "warnings": { "type": "array", "items": {} } }, "required": ["event", "baseRevision", "newRevision", "revision", "sessionId", "documentId", "originClientId", "added", "updated", "removedIds", "changedMeshIds", "referenceRemaps", "warnings"], "additionalProperties": false };
    var func41 = Object.prototype.hasOwnProperty;
    function validate29(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.event === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "event" }, message: "must have required property 'event'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.baseRevision === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "baseRevision" }, message: "must have required property 'baseRevision'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.newRevision === void 0) {
          const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "newRevision" }, message: "must have required property 'newRevision'" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (data.revision === void 0) {
          const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "revision" }, message: "must have required property 'revision'" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
        if (data.sessionId === void 0) {
          const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sessionId" }, message: "must have required property 'sessionId'" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
        if (data.documentId === void 0) {
          const err5 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "documentId" }, message: "must have required property 'documentId'" };
          if (vErrors === null) {
            vErrors = [err5];
          } else {
            vErrors.push(err5);
          }
          errors++;
        }
        if (data.originClientId === void 0) {
          const err6 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "originClientId" }, message: "must have required property 'originClientId'" };
          if (vErrors === null) {
            vErrors = [err6];
          } else {
            vErrors.push(err6);
          }
          errors++;
        }
        if (data.added === void 0) {
          const err7 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "added" }, message: "must have required property 'added'" };
          if (vErrors === null) {
            vErrors = [err7];
          } else {
            vErrors.push(err7);
          }
          errors++;
        }
        if (data.updated === void 0) {
          const err8 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "updated" }, message: "must have required property 'updated'" };
          if (vErrors === null) {
            vErrors = [err8];
          } else {
            vErrors.push(err8);
          }
          errors++;
        }
        if (data.removedIds === void 0) {
          const err9 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "removedIds" }, message: "must have required property 'removedIds'" };
          if (vErrors === null) {
            vErrors = [err9];
          } else {
            vErrors.push(err9);
          }
          errors++;
        }
        if (data.changedMeshIds === void 0) {
          const err10 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "changedMeshIds" }, message: "must have required property 'changedMeshIds'" };
          if (vErrors === null) {
            vErrors = [err10];
          } else {
            vErrors.push(err10);
          }
          errors++;
        }
        if (data.referenceRemaps === void 0) {
          const err11 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "referenceRemaps" }, message: "must have required property 'referenceRemaps'" };
          if (vErrors === null) {
            vErrors = [err11];
          } else {
            vErrors.push(err11);
          }
          errors++;
        }
        if (data.warnings === void 0) {
          const err12 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "warnings" }, message: "must have required property 'warnings'" };
          if (vErrors === null) {
            vErrors = [err12];
          } else {
            vErrors.push(err12);
          }
          errors++;
        }
        for (const key0 in data) {
          if (!func41.call(schema32.properties, key0)) {
            const err13 = { instancePath, schemaPath: "#/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key0 }, message: "must NOT have additional properties" };
            if (vErrors === null) {
              vErrors = [err13];
            } else {
              vErrors.push(err13);
            }
            errors++;
          }
        }
        if (data.event !== void 0) {
          let data0 = data.event;
          if (typeof data0 !== "string") {
            const err14 = { instancePath: instancePath + "/event", schemaPath: "#/properties/event/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err14];
            } else {
              vErrors.push(err14);
            }
            errors++;
          }
          if (!(data0 === "delta")) {
            const err15 = { instancePath: instancePath + "/event", schemaPath: "#/properties/event/enum", keyword: "enum", params: { allowedValues: schema32.properties.event.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err15];
            } else {
              vErrors.push(err15);
            }
            errors++;
          }
        }
        if (data.baseRevision !== void 0) {
          let data1 = data.baseRevision;
          if (!(typeof data1 == "number" && (!(data1 % 1) && !isNaN(data1)) && isFinite(data1))) {
            const err16 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err16];
            } else {
              vErrors.push(err16);
            }
            errors++;
          }
          if (typeof data1 == "number" && isFinite(data1)) {
            if (data1 > 9007199254740991 || isNaN(data1)) {
              const err17 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
              if (vErrors === null) {
                vErrors = [err17];
              } else {
                vErrors.push(err17);
              }
              errors++;
            }
            if (data1 < 0 || isNaN(data1)) {
              const err18 = { instancePath: instancePath + "/baseRevision", schemaPath: "#/properties/baseRevision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err18];
              } else {
                vErrors.push(err18);
              }
              errors++;
            }
          }
        }
        if (data.newRevision !== void 0) {
          let data2 = data.newRevision;
          if (!(typeof data2 == "number" && (!(data2 % 1) && !isNaN(data2)) && isFinite(data2))) {
            const err19 = { instancePath: instancePath + "/newRevision", schemaPath: "#/properties/newRevision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err19];
            } else {
              vErrors.push(err19);
            }
            errors++;
          }
          if (typeof data2 == "number" && isFinite(data2)) {
            if (data2 > 9007199254740991 || isNaN(data2)) {
              const err20 = { instancePath: instancePath + "/newRevision", schemaPath: "#/properties/newRevision/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
              if (vErrors === null) {
                vErrors = [err20];
              } else {
                vErrors.push(err20);
              }
              errors++;
            }
            if (data2 < 0 || isNaN(data2)) {
              const err21 = { instancePath: instancePath + "/newRevision", schemaPath: "#/properties/newRevision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err21];
              } else {
                vErrors.push(err21);
              }
              errors++;
            }
          }
        }
        if (data.revision !== void 0) {
          let data3 = data.revision;
          if (!(typeof data3 == "number" && (!(data3 % 1) && !isNaN(data3)) && isFinite(data3))) {
            const err22 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err22];
            } else {
              vErrors.push(err22);
            }
            errors++;
          }
          if (typeof data3 == "number" && isFinite(data3)) {
            if (data3 > 9007199254740991 || isNaN(data3)) {
              const err23 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
              if (vErrors === null) {
                vErrors = [err23];
              } else {
                vErrors.push(err23);
              }
              errors++;
            }
            if (data3 < 0 || isNaN(data3)) {
              const err24 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err24];
              } else {
                vErrors.push(err24);
              }
              errors++;
            }
          }
        }
        if (data.sessionId !== void 0) {
          let data4 = data.sessionId;
          if (typeof data4 === "string") {
            if (!pattern1.test(data4)) {
              const err25 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, message: 'must match pattern "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"' };
              if (vErrors === null) {
                vErrors = [err25];
              } else {
                vErrors.push(err25);
              }
              errors++;
            }
          } else {
            const err26 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err26];
            } else {
              vErrors.push(err26);
            }
            errors++;
          }
        }
        if (data.documentId !== void 0) {
          let data5 = data.documentId;
          if (typeof data5 === "string") {
            if (func2(data5) < 1) {
              const err27 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err27];
              } else {
                vErrors.push(err27);
              }
              errors++;
            }
          } else {
            const err28 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err28];
            } else {
              vErrors.push(err28);
            }
            errors++;
          }
        }
        if (data.originClientId !== void 0) {
          let data6 = data.originClientId;
          if (typeof data6 === "string") {
            if (func2(data6) < 1) {
              const err29 = { instancePath: instancePath + "/originClientId", schemaPath: "#/properties/originClientId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err29];
              } else {
                vErrors.push(err29);
              }
              errors++;
            }
          } else {
            const err30 = { instancePath: instancePath + "/originClientId", schemaPath: "#/properties/originClientId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err30];
            } else {
              vErrors.push(err30);
            }
            errors++;
          }
        }
        if (data.added !== void 0) {
          let data7 = data.added;
          if (Array.isArray(data7)) {
            const len0 = data7.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data8 = data7[i0];
              if (data8 && typeof data8 == "object" && !Array.isArray(data8)) {
                if (data8.kind === void 0) {
                  const err31 = { instancePath: instancePath + "/added/" + i0, schemaPath: "#/definitions/SessionEntityPatch/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
                  if (vErrors === null) {
                    vErrors = [err31];
                  } else {
                    vErrors.push(err31);
                  }
                  errors++;
                }
                if (data8.id === void 0) {
                  const err32 = { instancePath: instancePath + "/added/" + i0, schemaPath: "#/definitions/SessionEntityPatch/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                  if (vErrors === null) {
                    vErrors = [err32];
                  } else {
                    vErrors.push(err32);
                  }
                  errors++;
                }
                if (data8.index === void 0) {
                  const err33 = { instancePath: instancePath + "/added/" + i0, schemaPath: "#/definitions/SessionEntityPatch/required", keyword: "required", params: { missingProperty: "index" }, message: "must have required property 'index'" };
                  if (vErrors === null) {
                    vErrors = [err33];
                  } else {
                    vErrors.push(err33);
                  }
                  errors++;
                }
                if (data8.value === void 0) {
                  const err34 = { instancePath: instancePath + "/added/" + i0, schemaPath: "#/definitions/SessionEntityPatch/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                  if (vErrors === null) {
                    vErrors = [err34];
                  } else {
                    vErrors.push(err34);
                  }
                  errors++;
                }
                for (const key1 in data8) {
                  if (!(key1 === "kind" || key1 === "id" || key1 === "index" || key1 === "value")) {
                    const err35 = { instancePath: instancePath + "/added/" + i0, schemaPath: "#/definitions/SessionEntityPatch/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key1 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err35];
                    } else {
                      vErrors.push(err35);
                    }
                    errors++;
                  }
                }
                if (data8.kind !== void 0) {
                  let data9 = data8.kind;
                  if (typeof data9 !== "string") {
                    const err36 = { instancePath: instancePath + "/added/" + i0 + "/kind", schemaPath: "#/definitions/SessionEntityPatch/properties/kind/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err36];
                    } else {
                      vErrors.push(err36);
                    }
                    errors++;
                  }
                  if (!(data9 === "feature" || data9 === "sketch" || data9 === "body")) {
                    const err37 = { instancePath: instancePath + "/added/" + i0 + "/kind", schemaPath: "#/definitions/SessionEntityPatch/properties/kind/enum", keyword: "enum", params: { allowedValues: schema31.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                    if (vErrors === null) {
                      vErrors = [err37];
                    } else {
                      vErrors.push(err37);
                    }
                    errors++;
                  }
                }
                if (data8.id !== void 0) {
                  let data10 = data8.id;
                  if (typeof data10 === "string") {
                    if (func2(data10) < 1) {
                      const err38 = { instancePath: instancePath + "/added/" + i0 + "/id", schemaPath: "#/definitions/SessionEntityPatch/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      if (vErrors === null) {
                        vErrors = [err38];
                      } else {
                        vErrors.push(err38);
                      }
                      errors++;
                    }
                  } else {
                    const err39 = { instancePath: instancePath + "/added/" + i0 + "/id", schemaPath: "#/definitions/SessionEntityPatch/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err39];
                    } else {
                      vErrors.push(err39);
                    }
                    errors++;
                  }
                }
                if (data8.index !== void 0) {
                  let data11 = data8.index;
                  if (!(typeof data11 == "number" && (!(data11 % 1) && !isNaN(data11)) && isFinite(data11))) {
                    const err40 = { instancePath: instancePath + "/added/" + i0 + "/index", schemaPath: "#/definitions/SessionEntityPatch/properties/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err40];
                    } else {
                      vErrors.push(err40);
                    }
                    errors++;
                  }
                  if (typeof data11 == "number" && isFinite(data11)) {
                    if (data11 > 9007199254740991 || isNaN(data11)) {
                      const err41 = { instancePath: instancePath + "/added/" + i0 + "/index", schemaPath: "#/definitions/SessionEntityPatch/properties/index/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
                      if (vErrors === null) {
                        vErrors = [err41];
                      } else {
                        vErrors.push(err41);
                      }
                      errors++;
                    }
                    if (data11 < 0 || isNaN(data11)) {
                      const err42 = { instancePath: instancePath + "/added/" + i0 + "/index", schemaPath: "#/definitions/SessionEntityPatch/properties/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                      if (vErrors === null) {
                        vErrors = [err42];
                      } else {
                        vErrors.push(err42);
                      }
                      errors++;
                    }
                  }
                }
                if (data8.value !== void 0) {
                  let data12 = data8.value;
                  if (data12 && typeof data12 == "object" && !Array.isArray(data12)) {
                  } else {
                    const err43 = { instancePath: instancePath + "/added/" + i0 + "/value", schemaPath: "#/definitions/SessionEntityPatch/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                    if (vErrors === null) {
                      vErrors = [err43];
                    } else {
                      vErrors.push(err43);
                    }
                    errors++;
                  }
                }
              } else {
                const err44 = { instancePath: instancePath + "/added/" + i0, schemaPath: "#/definitions/SessionEntityPatch/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err44];
                } else {
                  vErrors.push(err44);
                }
                errors++;
              }
            }
          } else {
            const err45 = { instancePath: instancePath + "/added", schemaPath: "#/properties/added/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err45];
            } else {
              vErrors.push(err45);
            }
            errors++;
          }
        }
        if (data.updated !== void 0) {
          let data13 = data.updated;
          if (Array.isArray(data13)) {
            const len1 = data13.length;
            for (let i1 = 0; i1 < len1; i1++) {
              let data14 = data13[i1];
              if (data14 && typeof data14 == "object" && !Array.isArray(data14)) {
                if (data14.kind === void 0) {
                  const err46 = { instancePath: instancePath + "/updated/" + i1, schemaPath: "#/definitions/SessionEntityPatch/required", keyword: "required", params: { missingProperty: "kind" }, message: "must have required property 'kind'" };
                  if (vErrors === null) {
                    vErrors = [err46];
                  } else {
                    vErrors.push(err46);
                  }
                  errors++;
                }
                if (data14.id === void 0) {
                  const err47 = { instancePath: instancePath + "/updated/" + i1, schemaPath: "#/definitions/SessionEntityPatch/required", keyword: "required", params: { missingProperty: "id" }, message: "must have required property 'id'" };
                  if (vErrors === null) {
                    vErrors = [err47];
                  } else {
                    vErrors.push(err47);
                  }
                  errors++;
                }
                if (data14.index === void 0) {
                  const err48 = { instancePath: instancePath + "/updated/" + i1, schemaPath: "#/definitions/SessionEntityPatch/required", keyword: "required", params: { missingProperty: "index" }, message: "must have required property 'index'" };
                  if (vErrors === null) {
                    vErrors = [err48];
                  } else {
                    vErrors.push(err48);
                  }
                  errors++;
                }
                if (data14.value === void 0) {
                  const err49 = { instancePath: instancePath + "/updated/" + i1, schemaPath: "#/definitions/SessionEntityPatch/required", keyword: "required", params: { missingProperty: "value" }, message: "must have required property 'value'" };
                  if (vErrors === null) {
                    vErrors = [err49];
                  } else {
                    vErrors.push(err49);
                  }
                  errors++;
                }
                for (const key2 in data14) {
                  if (!(key2 === "kind" || key2 === "id" || key2 === "index" || key2 === "value")) {
                    const err50 = { instancePath: instancePath + "/updated/" + i1, schemaPath: "#/definitions/SessionEntityPatch/additionalProperties", keyword: "additionalProperties", params: { additionalProperty: key2 }, message: "must NOT have additional properties" };
                    if (vErrors === null) {
                      vErrors = [err50];
                    } else {
                      vErrors.push(err50);
                    }
                    errors++;
                  }
                }
                if (data14.kind !== void 0) {
                  let data15 = data14.kind;
                  if (typeof data15 !== "string") {
                    const err51 = { instancePath: instancePath + "/updated/" + i1 + "/kind", schemaPath: "#/definitions/SessionEntityPatch/properties/kind/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err51];
                    } else {
                      vErrors.push(err51);
                    }
                    errors++;
                  }
                  if (!(data15 === "feature" || data15 === "sketch" || data15 === "body")) {
                    const err52 = { instancePath: instancePath + "/updated/" + i1 + "/kind", schemaPath: "#/definitions/SessionEntityPatch/properties/kind/enum", keyword: "enum", params: { allowedValues: schema31.properties.kind.enum }, message: "must be equal to one of the allowed values" };
                    if (vErrors === null) {
                      vErrors = [err52];
                    } else {
                      vErrors.push(err52);
                    }
                    errors++;
                  }
                }
                if (data14.id !== void 0) {
                  let data16 = data14.id;
                  if (typeof data16 === "string") {
                    if (func2(data16) < 1) {
                      const err53 = { instancePath: instancePath + "/updated/" + i1 + "/id", schemaPath: "#/definitions/SessionEntityPatch/properties/id/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                      if (vErrors === null) {
                        vErrors = [err53];
                      } else {
                        vErrors.push(err53);
                      }
                      errors++;
                    }
                  } else {
                    const err54 = { instancePath: instancePath + "/updated/" + i1 + "/id", schemaPath: "#/definitions/SessionEntityPatch/properties/id/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                    if (vErrors === null) {
                      vErrors = [err54];
                    } else {
                      vErrors.push(err54);
                    }
                    errors++;
                  }
                }
                if (data14.index !== void 0) {
                  let data17 = data14.index;
                  if (!(typeof data17 == "number" && (!(data17 % 1) && !isNaN(data17)) && isFinite(data17))) {
                    const err55 = { instancePath: instancePath + "/updated/" + i1 + "/index", schemaPath: "#/definitions/SessionEntityPatch/properties/index/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
                    if (vErrors === null) {
                      vErrors = [err55];
                    } else {
                      vErrors.push(err55);
                    }
                    errors++;
                  }
                  if (typeof data17 == "number" && isFinite(data17)) {
                    if (data17 > 9007199254740991 || isNaN(data17)) {
                      const err56 = { instancePath: instancePath + "/updated/" + i1 + "/index", schemaPath: "#/definitions/SessionEntityPatch/properties/index/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
                      if (vErrors === null) {
                        vErrors = [err56];
                      } else {
                        vErrors.push(err56);
                      }
                      errors++;
                    }
                    if (data17 < 0 || isNaN(data17)) {
                      const err57 = { instancePath: instancePath + "/updated/" + i1 + "/index", schemaPath: "#/definitions/SessionEntityPatch/properties/index/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
                      if (vErrors === null) {
                        vErrors = [err57];
                      } else {
                        vErrors.push(err57);
                      }
                      errors++;
                    }
                  }
                }
                if (data14.value !== void 0) {
                  let data18 = data14.value;
                  if (data18 && typeof data18 == "object" && !Array.isArray(data18)) {
                  } else {
                    const err58 = { instancePath: instancePath + "/updated/" + i1 + "/value", schemaPath: "#/definitions/SessionEntityPatch/properties/value/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                    if (vErrors === null) {
                      vErrors = [err58];
                    } else {
                      vErrors.push(err58);
                    }
                    errors++;
                  }
                }
              } else {
                const err59 = { instancePath: instancePath + "/updated/" + i1, schemaPath: "#/definitions/SessionEntityPatch/type", keyword: "type", params: { type: "object" }, message: "must be object" };
                if (vErrors === null) {
                  vErrors = [err59];
                } else {
                  vErrors.push(err59);
                }
                errors++;
              }
            }
          } else {
            const err60 = { instancePath: instancePath + "/updated", schemaPath: "#/properties/updated/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err60];
            } else {
              vErrors.push(err60);
            }
            errors++;
          }
        }
        if (data.removedIds !== void 0) {
          let data19 = data.removedIds;
          if (Array.isArray(data19)) {
            const len2 = data19.length;
            for (let i2 = 0; i2 < len2; i2++) {
              let data20 = data19[i2];
              if (typeof data20 === "string") {
                if (func2(data20) < 1) {
                  const err61 = { instancePath: instancePath + "/removedIds/" + i2, schemaPath: "#/properties/removedIds/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err61];
                  } else {
                    vErrors.push(err61);
                  }
                  errors++;
                }
              } else {
                const err62 = { instancePath: instancePath + "/removedIds/" + i2, schemaPath: "#/properties/removedIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err62];
                } else {
                  vErrors.push(err62);
                }
                errors++;
              }
            }
          } else {
            const err63 = { instancePath: instancePath + "/removedIds", schemaPath: "#/properties/removedIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err63];
            } else {
              vErrors.push(err63);
            }
            errors++;
          }
        }
        if (data.changedMeshIds !== void 0) {
          let data21 = data.changedMeshIds;
          if (Array.isArray(data21)) {
            const len3 = data21.length;
            for (let i3 = 0; i3 < len3; i3++) {
              let data22 = data21[i3];
              if (typeof data22 === "string") {
                if (func2(data22) < 1) {
                  const err64 = { instancePath: instancePath + "/changedMeshIds/" + i3, schemaPath: "#/properties/changedMeshIds/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err64];
                  } else {
                    vErrors.push(err64);
                  }
                  errors++;
                }
              } else {
                const err65 = { instancePath: instancePath + "/changedMeshIds/" + i3, schemaPath: "#/properties/changedMeshIds/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err65];
                } else {
                  vErrors.push(err65);
                }
                errors++;
              }
            }
          } else {
            const err66 = { instancePath: instancePath + "/changedMeshIds", schemaPath: "#/properties/changedMeshIds/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err66];
            } else {
              vErrors.push(err66);
            }
            errors++;
          }
        }
        if (data.referenceRemaps !== void 0) {
          if (!Array.isArray(data.referenceRemaps)) {
            const err67 = { instancePath: instancePath + "/referenceRemaps", schemaPath: "#/properties/referenceRemaps/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err67];
            } else {
              vErrors.push(err67);
            }
            errors++;
          }
        }
        if (data.warnings !== void 0) {
          if (!Array.isArray(data.warnings)) {
            const err68 = { instancePath: instancePath + "/warnings", schemaPath: "#/properties/warnings/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err68];
            } else {
              vErrors.push(err68);
            }
            errors++;
          }
        }
      } else {
        const err69 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err69];
        } else {
          vErrors.push(err69);
        }
        errors++;
      }
      validate29.errors = vErrors;
      return errors === 0;
    }
    exports.SessionSnapshotRequiredEvent = validate30;
    var schema35 = { "type": "object", "properties": { "event": { "type": "string", "enum": ["snapshot-required"] }, "sessionId": { "type": "string", "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, "documentId": { "type": "string", "minLength": 1 }, "revision": { "type": "integer", "minimum": 0, "maximum": 9007199254740991 }, "originClientId": { "type": "string", "minLength": 1 } }, "required": ["event", "sessionId", "documentId", "revision", "originClientId"], "additionalProperties": true };
    function validate30(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.event === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "event" }, message: "must have required property 'event'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.sessionId === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sessionId" }, message: "must have required property 'sessionId'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.documentId === void 0) {
          const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "documentId" }, message: "must have required property 'documentId'" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (data.revision === void 0) {
          const err3 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "revision" }, message: "must have required property 'revision'" };
          if (vErrors === null) {
            vErrors = [err3];
          } else {
            vErrors.push(err3);
          }
          errors++;
        }
        if (data.originClientId === void 0) {
          const err4 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "originClientId" }, message: "must have required property 'originClientId'" };
          if (vErrors === null) {
            vErrors = [err4];
          } else {
            vErrors.push(err4);
          }
          errors++;
        }
        if (data.event !== void 0) {
          let data0 = data.event;
          if (typeof data0 !== "string") {
            const err5 = { instancePath: instancePath + "/event", schemaPath: "#/properties/event/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
          if (!(data0 === "snapshot-required")) {
            const err6 = { instancePath: instancePath + "/event", schemaPath: "#/properties/event/enum", keyword: "enum", params: { allowedValues: schema35.properties.event.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err6];
            } else {
              vErrors.push(err6);
            }
            errors++;
          }
        }
        if (data.sessionId !== void 0) {
          let data1 = data.sessionId;
          if (typeof data1 === "string") {
            if (!pattern1.test(data1)) {
              const err7 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, message: 'must match pattern "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"' };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
          } else {
            const err8 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
        if (data.documentId !== void 0) {
          let data2 = data.documentId;
          if (typeof data2 === "string") {
            if (func2(data2) < 1) {
              const err9 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err9];
              } else {
                vErrors.push(err9);
              }
              errors++;
            }
          } else {
            const err10 = { instancePath: instancePath + "/documentId", schemaPath: "#/properties/documentId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err10];
            } else {
              vErrors.push(err10);
            }
            errors++;
          }
        }
        if (data.revision !== void 0) {
          let data3 = data.revision;
          if (!(typeof data3 == "number" && (!(data3 % 1) && !isNaN(data3)) && isFinite(data3))) {
            const err11 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/type", keyword: "type", params: { type: "integer" }, message: "must be integer" };
            if (vErrors === null) {
              vErrors = [err11];
            } else {
              vErrors.push(err11);
            }
            errors++;
          }
          if (typeof data3 == "number" && isFinite(data3)) {
            if (data3 > 9007199254740991 || isNaN(data3)) {
              const err12 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/maximum", keyword: "maximum", params: { comparison: "<=", limit: 9007199254740991 }, message: "must be <= 9007199254740991" };
              if (vErrors === null) {
                vErrors = [err12];
              } else {
                vErrors.push(err12);
              }
              errors++;
            }
            if (data3 < 0 || isNaN(data3)) {
              const err13 = { instancePath: instancePath + "/revision", schemaPath: "#/properties/revision/minimum", keyword: "minimum", params: { comparison: ">=", limit: 0 }, message: "must be >= 0" };
              if (vErrors === null) {
                vErrors = [err13];
              } else {
                vErrors.push(err13);
              }
              errors++;
            }
          }
        }
        if (data.originClientId !== void 0) {
          let data4 = data.originClientId;
          if (typeof data4 === "string") {
            if (func2(data4) < 1) {
              const err14 = { instancePath: instancePath + "/originClientId", schemaPath: "#/properties/originClientId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err14];
              } else {
                vErrors.push(err14);
              }
              errors++;
            }
          } else {
            const err15 = { instancePath: instancePath + "/originClientId", schemaPath: "#/properties/originClientId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err15];
            } else {
              vErrors.push(err15);
            }
            errors++;
          }
        }
      } else {
        const err16 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err16];
        } else {
          vErrors.push(err16);
        }
        errors++;
      }
      validate30.errors = vErrors;
      return errors === 0;
    }
    exports.SelectionEvent = validate31;
    var schema36 = { "type": "object", "properties": { "event": { "type": "string", "enum": ["selection"] }, "clientId": { "type": "string", "minLength": 1 }, "ids": { "type": "array", "items": { "type": "string", "minLength": 1 } } }, "required": ["event", "clientId", "ids"], "additionalProperties": true };
    function validate31(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.event === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "event" }, message: "must have required property 'event'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.clientId === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "clientId" }, message: "must have required property 'clientId'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.ids === void 0) {
          const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "ids" }, message: "must have required property 'ids'" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (data.event !== void 0) {
          let data0 = data.event;
          if (typeof data0 !== "string") {
            const err3 = { instancePath: instancePath + "/event", schemaPath: "#/properties/event/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
          if (!(data0 === "selection")) {
            const err4 = { instancePath: instancePath + "/event", schemaPath: "#/properties/event/enum", keyword: "enum", params: { allowedValues: schema36.properties.event.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
        }
        if (data.clientId !== void 0) {
          let data1 = data.clientId;
          if (typeof data1 === "string") {
            if (func2(data1) < 1) {
              const err5 = { instancePath: instancePath + "/clientId", schemaPath: "#/properties/clientId/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
          } else {
            const err6 = { instancePath: instancePath + "/clientId", schemaPath: "#/properties/clientId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err6];
            } else {
              vErrors.push(err6);
            }
            errors++;
          }
        }
        if (data.ids !== void 0) {
          let data2 = data.ids;
          if (Array.isArray(data2)) {
            const len0 = data2.length;
            for (let i0 = 0; i0 < len0; i0++) {
              let data3 = data2[i0];
              if (typeof data3 === "string") {
                if (func2(data3) < 1) {
                  const err7 = { instancePath: instancePath + "/ids/" + i0, schemaPath: "#/properties/ids/items/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
                  if (vErrors === null) {
                    vErrors = [err7];
                  } else {
                    vErrors.push(err7);
                  }
                  errors++;
                }
              } else {
                const err8 = { instancePath: instancePath + "/ids/" + i0, schemaPath: "#/properties/ids/items/type", keyword: "type", params: { type: "string" }, message: "must be string" };
                if (vErrors === null) {
                  vErrors = [err8];
                } else {
                  vErrors.push(err8);
                }
                errors++;
              }
            }
          } else {
            const err9 = { instancePath: instancePath + "/ids", schemaPath: "#/properties/ids/type", keyword: "type", params: { type: "array" }, message: "must be array" };
            if (vErrors === null) {
              vErrors = [err9];
            } else {
              vErrors.push(err9);
            }
            errors++;
          }
        }
      } else {
        const err10 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err10];
        } else {
          vErrors.push(err10);
        }
        errors++;
      }
      validate31.errors = vErrors;
      return errors === 0;
    }
    exports.CoreRestartedEvent = validate32;
    var schema37 = { "type": "object", "properties": { "event": { "type": "string", "enum": ["core-restarted"] }, "sessionId": { "type": "string", "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" } }, "required": ["event", "sessionId"], "additionalProperties": true };
    function validate32(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.event === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "event" }, message: "must have required property 'event'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.sessionId === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sessionId" }, message: "must have required property 'sessionId'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.event !== void 0) {
          let data0 = data.event;
          if (typeof data0 !== "string") {
            const err2 = { instancePath: instancePath + "/event", schemaPath: "#/properties/event/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err2];
            } else {
              vErrors.push(err2);
            }
            errors++;
          }
          if (!(data0 === "core-restarted")) {
            const err3 = { instancePath: instancePath + "/event", schemaPath: "#/properties/event/enum", keyword: "enum", params: { allowedValues: schema37.properties.event.enum }, message: "must be equal to one of the allowed values" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        }
        if (data.sessionId !== void 0) {
          let data1 = data.sessionId;
          if (typeof data1 === "string") {
            if (!pattern1.test(data1)) {
              const err4 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/pattern", keyword: "pattern", params: { pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" }, message: 'must match pattern "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"' };
              if (vErrors === null) {
                vErrors = [err4];
              } else {
                vErrors.push(err4);
              }
              errors++;
            }
          } else {
            const err5 = { instancePath: instancePath + "/sessionId", schemaPath: "#/properties/sessionId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        }
      } else {
        const err6 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
      validate32.errors = vErrors;
      return errors === 0;
    }
    exports.PairParams = validate33;
    var pattern18 = new RegExp("^[A-Za-z0-9_-]{43}$", "u");
    var pattern19 = new RegExp("^[^\\u0000-\\u001f\\u007f]+$", "u");
    function validate33(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.pairingToken === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "pairingToken" }, message: "must have required property 'pairingToken'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.deviceName === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "deviceName" }, message: "must have required property 'deviceName'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.pairingToken !== void 0) {
          let data0 = data.pairingToken;
          if (typeof data0 === "string") {
            if (!pattern18.test(data0)) {
              const err2 = { instancePath: instancePath + "/pairingToken", schemaPath: "#/properties/pairingToken/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_-]{43}$" }, message: 'must match pattern "^[A-Za-z0-9_-]{43}$"' };
              if (vErrors === null) {
                vErrors = [err2];
              } else {
                vErrors.push(err2);
              }
              errors++;
            }
          } else {
            const err3 = { instancePath: instancePath + "/pairingToken", schemaPath: "#/properties/pairingToken/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        }
        if (data.deviceName !== void 0) {
          let data1 = data.deviceName;
          if (typeof data1 === "string") {
            if (func2(data1) > 80) {
              const err4 = { instancePath: instancePath + "/deviceName", schemaPath: "#/properties/deviceName/maxLength", keyword: "maxLength", params: { limit: 80 }, message: "must NOT have more than 80 characters" };
              if (vErrors === null) {
                vErrors = [err4];
              } else {
                vErrors.push(err4);
              }
              errors++;
            }
            if (func2(data1) < 1) {
              const err5 = { instancePath: instancePath + "/deviceName", schemaPath: "#/properties/deviceName/minLength", keyword: "minLength", params: { limit: 1 }, message: "must NOT have fewer than 1 characters" };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
            if (!pattern19.test(data1)) {
              const err6 = { instancePath: instancePath + "/deviceName", schemaPath: "#/properties/deviceName/pattern", keyword: "pattern", params: { pattern: "^[^\\u0000-\\u001f\\u007f]+$" }, message: 'must match pattern "^[^\\u0000-\\u001f\\u007f]+$"' };
              if (vErrors === null) {
                vErrors = [err6];
              } else {
                vErrors.push(err6);
              }
              errors++;
            }
          } else {
            const err7 = { instancePath: instancePath + "/deviceName", schemaPath: "#/properties/deviceName/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err7];
            } else {
              vErrors.push(err7);
            }
            errors++;
          }
        }
      } else {
        const err8 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err8];
        } else {
          vErrors.push(err8);
        }
        errors++;
      }
      validate33.errors = vErrors;
      return errors === 0;
    }
    exports.AuthenticateParams = validate34;
    function validate34(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.deviceId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "deviceId" }, message: "must have required property 'deviceId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.credential === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "credential" }, message: "must have required property 'credential'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.deviceId !== void 0) {
          let data0 = data.deviceId;
          if (typeof data0 === "string") {
            if (!pattern4.test(data0)) {
              const err2 = { instancePath: instancePath + "/deviceId", schemaPath: "#/properties/deviceId/pattern", keyword: "pattern", params: { pattern: "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" }, message: 'must match pattern "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"' };
              if (vErrors === null) {
                vErrors = [err2];
              } else {
                vErrors.push(err2);
              }
              errors++;
            }
          } else {
            const err3 = { instancePath: instancePath + "/deviceId", schemaPath: "#/properties/deviceId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        }
        if (data.credential !== void 0) {
          let data1 = data.credential;
          if (typeof data1 === "string") {
            if (!pattern18.test(data1)) {
              const err4 = { instancePath: instancePath + "/credential", schemaPath: "#/properties/credential/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_-]{43}$" }, message: 'must match pattern "^[A-Za-z0-9_-]{43}$"' };
              if (vErrors === null) {
                vErrors = [err4];
              } else {
                vErrors.push(err4);
              }
              errors++;
            }
          } else {
            const err5 = { instancePath: instancePath + "/credential", schemaPath: "#/properties/credential/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        }
      } else {
        const err6 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
      validate34.errors = vErrors;
      return errors === 0;
    }
    exports.PairReply = validate35;
    function validate35(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.deviceId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "deviceId" }, message: "must have required property 'deviceId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.credential === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "credential" }, message: "must have required property 'credential'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.sessionToken === void 0) {
          const err2 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sessionToken" }, message: "must have required property 'sessionToken'" };
          if (vErrors === null) {
            vErrors = [err2];
          } else {
            vErrors.push(err2);
          }
          errors++;
        }
        if (data.deviceId !== void 0) {
          let data0 = data.deviceId;
          if (typeof data0 === "string") {
            if (!pattern4.test(data0)) {
              const err3 = { instancePath: instancePath + "/deviceId", schemaPath: "#/properties/deviceId/pattern", keyword: "pattern", params: { pattern: "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" }, message: 'must match pattern "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"' };
              if (vErrors === null) {
                vErrors = [err3];
              } else {
                vErrors.push(err3);
              }
              errors++;
            }
          } else {
            const err4 = { instancePath: instancePath + "/deviceId", schemaPath: "#/properties/deviceId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err4];
            } else {
              vErrors.push(err4);
            }
            errors++;
          }
        }
        if (data.credential !== void 0) {
          let data1 = data.credential;
          if (typeof data1 === "string") {
            if (!pattern18.test(data1)) {
              const err5 = { instancePath: instancePath + "/credential", schemaPath: "#/properties/credential/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_-]{43}$" }, message: 'must match pattern "^[A-Za-z0-9_-]{43}$"' };
              if (vErrors === null) {
                vErrors = [err5];
              } else {
                vErrors.push(err5);
              }
              errors++;
            }
          } else {
            const err6 = { instancePath: instancePath + "/credential", schemaPath: "#/properties/credential/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err6];
            } else {
              vErrors.push(err6);
            }
            errors++;
          }
        }
        if (data.sessionToken !== void 0) {
          let data2 = data.sessionToken;
          if (typeof data2 === "string") {
            if (!pattern18.test(data2)) {
              const err7 = { instancePath: instancePath + "/sessionToken", schemaPath: "#/properties/sessionToken/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_-]{43}$" }, message: 'must match pattern "^[A-Za-z0-9_-]{43}$"' };
              if (vErrors === null) {
                vErrors = [err7];
              } else {
                vErrors.push(err7);
              }
              errors++;
            }
          } else {
            const err8 = { instancePath: instancePath + "/sessionToken", schemaPath: "#/properties/sessionToken/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err8];
            } else {
              vErrors.push(err8);
            }
            errors++;
          }
        }
      } else {
        const err9 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err9];
        } else {
          vErrors.push(err9);
        }
        errors++;
      }
      validate35.errors = vErrors;
      return errors === 0;
    }
    exports.AuthenticateReply = validate36;
    function validate36(data, { instancePath = "", parentData, parentDataProperty, rootData = data } = {}) {
      let vErrors = null;
      let errors = 0;
      if (data && typeof data == "object" && !Array.isArray(data)) {
        if (data.deviceId === void 0) {
          const err0 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "deviceId" }, message: "must have required property 'deviceId'" };
          if (vErrors === null) {
            vErrors = [err0];
          } else {
            vErrors.push(err0);
          }
          errors++;
        }
        if (data.sessionToken === void 0) {
          const err1 = { instancePath, schemaPath: "#/required", keyword: "required", params: { missingProperty: "sessionToken" }, message: "must have required property 'sessionToken'" };
          if (vErrors === null) {
            vErrors = [err1];
          } else {
            vErrors.push(err1);
          }
          errors++;
        }
        if (data.deviceId !== void 0) {
          let data0 = data.deviceId;
          if (typeof data0 === "string") {
            if (!pattern4.test(data0)) {
              const err2 = { instancePath: instancePath + "/deviceId", schemaPath: "#/properties/deviceId/pattern", keyword: "pattern", params: { pattern: "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" }, message: 'must match pattern "^device-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$"' };
              if (vErrors === null) {
                vErrors = [err2];
              } else {
                vErrors.push(err2);
              }
              errors++;
            }
          } else {
            const err3 = { instancePath: instancePath + "/deviceId", schemaPath: "#/properties/deviceId/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err3];
            } else {
              vErrors.push(err3);
            }
            errors++;
          }
        }
        if (data.sessionToken !== void 0) {
          let data1 = data.sessionToken;
          if (typeof data1 === "string") {
            if (!pattern18.test(data1)) {
              const err4 = { instancePath: instancePath + "/sessionToken", schemaPath: "#/properties/sessionToken/pattern", keyword: "pattern", params: { pattern: "^[A-Za-z0-9_-]{43}$" }, message: 'must match pattern "^[A-Za-z0-9_-]{43}$"' };
              if (vErrors === null) {
                vErrors = [err4];
              } else {
                vErrors.push(err4);
              }
              errors++;
            }
          } else {
            const err5 = { instancePath: instancePath + "/sessionToken", schemaPath: "#/properties/sessionToken/type", keyword: "type", params: { type: "string" }, message: "must be string" };
            if (vErrors === null) {
              vErrors = [err5];
            } else {
              vErrors.push(err5);
            }
            errors++;
          }
        }
      } else {
        const err6 = { instancePath, schemaPath: "#/type", keyword: "type", params: { type: "object" }, message: "must be object" };
        if (vErrors === null) {
          vErrors = [err6];
        } else {
          vErrors.push(err6);
        }
        errors++;
      }
      validate36.errors = vErrors;
      return errors === 0;
    }
  }
});
export default require_session_validators();
