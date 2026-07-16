/**
 * Strip JSON-Schema-2020-12 fields that Gemini's `function_declarations`
 * schema does not accept, and reshape multi-typed `type: "string"|"number"`
 * properties into the `oneOf` array variant Gemini expects.
 *
 * Gemini's accepted subset is OpenAPI 3.0 / Protobuf-like:
 *   - `type` ∈ "string" | "number" | "integer" | "boolean" | "array" | "object"
 *     ("null" is implicit via `nullable: true`)
 *   - `enum` array (string only)
 *   - `description`, `format`, `items` (for arrays), `properties` (for objects)
 *   - `required`, `nullable`
 *
 * Disallowed JSON-Schema extras that Zod's tooling emits:
 *   - `$schema`, `additionalProperties`, `exclusiveMinimum`, `exclusiveMaximum`,
 *     `minLength`, `maxLength`, `pattern` (Gemini ignores some silently but
 *     rejects others with a 400)
 *   - compound type unions: `type: "string"|"number"` (oneOf-style) ->
 *     emitted as `type: ["string","number"]` which Gemini refuses with
 *     "Proto field is not repeating, cannot start list".
 *
 * After sanitization, multi-type unions are rewritten as `anyOf: [{type:string}, {type:number}]`.
 */
export function sanitizeJsonSchema(schema: unknown): unknown {
  if (schema == null || typeof schema !== "object") return schema;
  const obj = schema as Record<string, unknown>;

  // Strip forbidden keywords at the root (and we'll do the same recursively below).
  delete obj.$schema;
  delete obj.exclusiveMinimum;
  delete obj.exclusiveMaximum;
  delete obj.additionalProperties;
  // Gemini tolerates these but they are noise; leave alone for now.

  // Convert `type` array to anyOf. Gemini rejects `type: ["x","y"]` with
  // "Proto field is not repeating, cannot start list". When a multi-type
  // union is encountered, replace it with an anyOf and drop the offending
  // `type` array entirely.
  if (Array.isArray(obj.type)) {
    const types = obj.type as string[];
    if (types.length > 1) {
      const branches = types.map((t) => ({ type: t }));
      const existingAnyOf = (obj as { anyOf?: unknown[] }).anyOf;
      obj.anyOf = Array.isArray(existingAnyOf) ? [...existingAnyOf, ...branches] : branches;
    } else if (types.length === 1) {
      obj.type = types[0];
    } else {
      delete obj.type;
    }
    delete obj.type; // always drop the array form, even after the anyOf rewrite
  }

  // Recurse into properties, items, anyOf, oneOf, allOf.
  for (const key of ["properties", "definitions", "patternProperties"]) {
    const props = obj[key] as Record<string, unknown> | undefined;
    if (props && typeof props === "object" && !Array.isArray(props)) {
      for (const k of Object.keys(props)) {
        props[k] = sanitizeJsonSchema(props[k]);
      }
    }
  }
  if (obj.items) {
    obj.items = sanitizeJsonSchema(obj.items);
  }
  for (const k of ["anyOf", "oneOf", "allOf"]) {
    const branches = obj[k];
    if (Array.isArray(branches)) {
      obj[k] = branches.map((b) => sanitizeJsonSchema(b));
    }
  }

  return obj;
}

/**
 * Gemini requires `parameters` on a function declaration to be an
 * OpenAPI 3.0 object with at minimum `{ type: "object", properties: {...} }`.
 * If the MCP server returns a top-level array, primitive, or missing object,
 * we wrap/normalize it. Returns a fresh object so callers can't mutate input.
 */
export function toGeminiParameters(inputSchema: unknown): Record<string, unknown> {
  const sanitized = sanitizeJsonSchema(inputSchema ?? {}) as Record<string, unknown>;
  const obj: Record<string, unknown> = { ...sanitized };
  if (obj.type === undefined) obj.type = "object";
  if (obj.type === "object" && obj.properties === undefined) obj.properties = {};
  return obj;
}