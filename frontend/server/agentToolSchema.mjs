export class ToolArgumentValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ToolArgumentValidationError";
    this.code = "INVALID_TOOL_ARGUMENTS";
    this.status = 422;
    this.details = details;
  }
}

export function validateToolArguments(
  schema,
  value,
  { rejectUnknown = true } = {}
) {
  const errors = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolArgumentValidationError(
      "tool arguments must be an object",
      [{ path: "$", reason: "expected object" }]
    );
  }

  const properties = schema?.properties || {};
  const required = new Set(schema?.required || []);

  for (const key of required) {
    if (!(key in value)) {
      errors.push({
        path: `$.${key}`,
        reason: "required"
      });
    }
  }

  for (const [key, current] of Object.entries(value)) {
    const propertySchema = properties[key];

    if (!propertySchema) {
      if (rejectUnknown) {
        errors.push({
          path: `$.${key}`,
          reason: "unknown property"
        });
      }
      continue;
    }

    validateScalar(
      propertySchema,
      current,
      `$.${key}`,
      errors
    );
  }

  if (errors.length) {
    throw new ToolArgumentValidationError(
      "tool arguments failed validation",
      errors
    );
  }

  return structuredClone(value);
}

function validateScalar(schema, value, path, errors) {
  const type = schema.type;

  if (type === "string" && typeof value !== "string") {
    errors.push({ path, reason: "expected string" });
    return;
  }

  if (
    type === "number" &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    errors.push({ path, reason: "expected finite number" });
    return;
  }

  if (
    type === "integer" &&
    (!Number.isInteger(value))
  ) {
    errors.push({ path, reason: "expected integer" });
    return;
  }

  if (type === "boolean" && typeof value !== "boolean") {
    errors.push({ path, reason: "expected boolean" });
    return;
  }

  if (
    Array.isArray(schema.enum) &&
    !schema.enum.includes(value)
  ) {
    errors.push({
      path,
      reason: `expected one of ${schema.enum.join(", ")}`
    });
  }

  if (
    typeof schema.minimum === "number" &&
    typeof value === "number" &&
    value < schema.minimum
  ) {
    errors.push({
      path,
      reason: `must be >= ${schema.minimum}`
    });
  }

  if (
    typeof schema.maximum === "number" &&
    typeof value === "number" &&
    value > schema.maximum
  ) {
    errors.push({
      path,
      reason: `must be <= ${schema.maximum}`
    });
  }
}
