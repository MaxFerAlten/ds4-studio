import test from "node:test";
import assert from "node:assert/strict";
import {
  ToolArgumentValidationError,
  validateToolArguments
} from "./agentToolSchema.mjs";

// Test schema with various field types
const basicSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "integer", minimum: 0, maximum: 150 },
    score: { type: "number", minimum: 0, maximum: 100 },
    active: { type: "boolean" },
    status: { type: "string", enum: ["pending", "approved", "rejected"] }
  },
  required: ["name"]
};

// Test: Minimum valid payload
test("validateToolArguments accepts minimum valid payload", () => {
  const value = { name: "Alice" };
  const result = validateToolArguments(basicSchema, value);
  assert.deepEqual(result, value);
});

// Test: Minimum valid payload with all optional fields
test("validateToolArguments accepts valid payload with all fields", () => {
  const value = {
    name: "Bob",
    age: 30,
    score: 85.5,
    active: true,
    status: "approved"
  };
  const result = validateToolArguments(basicSchema, value);
  assert.deepEqual(result, value);
});

// Test: Missing required field
test("validateToolArguments rejects missing required field", () => {
  const value = { age: 25 };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.code, "INVALID_TOOL_ARGUMENTS");
      assert.equal(err.status, 422);
      assert.match(err.message, /failed validation/);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.name");
      assert.equal(err.details[0].reason, "required");
      return true;
    }
  );
});

// Test: Wrong type - string instead of integer
test("validateToolArguments rejects wrong type string for integer", () => {
  const value = { name: "Charlie", age: "thirty" };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.age");
      assert.match(err.details[0].reason, /expected integer/);
      return true;
    }
  );
});

// Test: Wrong type - number as integer instead of float
test("validateToolArguments rejects float for integer field", () => {
  const value = { name: "Dave", age: 30.5 };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.age");
      assert.match(err.details[0].reason, /expected integer/);
      return true;
    }
  );
});

// Test: Wrong type - string for number field
test("validateToolArguments rejects string for number field", () => {
  const value = { name: "Eve", score: "85.5" };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.score");
      assert.match(err.details[0].reason, /expected finite number/);
      return true;
    }
  );
});

// Test: Wrong type - string for boolean field
test("validateToolArguments rejects string for boolean field", () => {
  const value = { name: "Frank", active: "true" };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.active");
      assert.match(err.details[0].reason, /expected boolean/);
      return true;
    }
  );
});

// Test: Wrong type - number for string field
test("validateToolArguments rejects number for string field", () => {
  const value = { name: 123 };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.name");
      assert.match(err.details[0].reason, /expected string/);
      return true;
    }
  );
});

// Test: Wrong enum value
test("validateToolArguments rejects wrong enum value", () => {
  const value = { name: "Grace", status: "unknown" };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.status");
      assert.match(err.details[0].reason, /expected one of/);
      assert.match(err.details[0].reason, /pending/);
      assert.match(err.details[0].reason, /approved/);
      assert.match(err.details[0].reason, /rejected/);
      return true;
    }
  );
});

// Test: Unknown property with rejectUnknown=true (default)
test("validateToolArguments rejects unknown property by default", () => {
  const value = { name: "Helen", unknown_field: "value" };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.unknown_field");
      assert.equal(err.details[0].reason, "unknown property");
      return true;
    }
  );
});

// Test: Unknown property with rejectUnknown=false
test("validateToolArguments accepts unknown property when rejectUnknown=false", () => {
  const value = { name: "Ivan", unknown_field: "value" };
  const result = validateToolArguments(basicSchema, value, { rejectUnknown: false });
  assert.deepEqual(result, value);
});

// Test: Multiple unknown properties
test("validateToolArguments reports multiple unknown properties", () => {
  const value = { name: "Jack", field1: "a", field2: "b" };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 2);
      const reasons = err.details.map(d => d.reason);
      assert.ok(reasons.every(r => r === "unknown property"));
      return true;
    }
  );
});

// Test: Upper limit violation (maximum)
test("validateToolArguments rejects value above maximum", () => {
  const value = { name: "Kelly", age: 151 };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.age");
      assert.match(err.details[0].reason, /must be <= 150/);
      return true;
    }
  );
});

// Test: Upper limit violation for number field
test("validateToolArguments rejects number above maximum", () => {
  const value = { name: "Liam", score: 101 };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.score");
      assert.match(err.details[0].reason, /must be <= 100/);
      return true;
    }
  );
});

// Test: Lower limit violation (minimum)
test("validateToolArguments rejects value below minimum", () => {
  const value = { name: "Mona", age: -1 };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.age");
      assert.match(err.details[0].reason, /must be >= 0/);
      return true;
    }
  );
});

// Test: NaN value for number field
test("validateToolArguments rejects NaN for number field", () => {
  const value = { name: "Nina", score: NaN };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.score");
      assert.match(err.details[0].reason, /expected finite number/);
      return true;
    }
  );
});

// Test: NaN value for integer field
test("validateToolArguments rejects NaN for integer field", () => {
  const value = { name: "Oscar", age: NaN };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.age");
      assert.match(err.details[0].reason, /expected integer/);
      return true;
    }
  );
});

// Test: Infinity value for number field (should be rejected)
test("validateToolArguments rejects Infinity for number field", () => {
  const value = { name: "Peter", score: Infinity };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$.score");
      assert.match(err.details[0].reason, /expected finite number/);
      return true;
    }
  );
});

// Test: Array instead of object
test("validateToolArguments rejects array instead of object", () => {
  const value = ["name", "Alice"];
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.message, "tool arguments must be an object");
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$");
      assert.equal(err.details[0].reason, "expected object");
      return true;
    }
  );
});

// Test: null value instead of object
test("validateToolArguments rejects null instead of object", () => {
  assert.throws(
    () => validateToolArguments(basicSchema, null),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.message, "tool arguments must be an object");
      assert.equal(err.details.length, 1);
      assert.equal(err.details[0].path, "$");
      assert.equal(err.details[0].reason, "expected object");
      return true;
    }
  );
});

// Test: undefined value instead of object
test("validateToolArguments rejects undefined instead of object", () => {
  assert.throws(
    () => validateToolArguments(basicSchema, undefined),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.message, "tool arguments must be an object");
      return true;
    }
  );
});

// Test: String instead of object
test("validateToolArguments rejects string instead of object", () => {
  assert.throws(
    () => validateToolArguments(basicSchema, "not an object"),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.message, "tool arguments must be an object");
      return true;
    }
  );
});

// Test: Multiple validation errors at once
test("validateToolArguments reports multiple errors simultaneously", () => {
  const value = {
    age: "thirty", // wrong type
    score: 101,    // above maximum
    status: "unknown" // wrong enum
  };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details.length, 4);
      const paths = err.details.map(d => d.path);
      assert.ok(paths.includes("$.name")); // missing required
      assert.ok(paths.includes("$.age"));  // wrong type
      assert.ok(paths.includes("$.score")); // above maximum
      assert.ok(paths.includes("$.status")); // wrong enum
      return true;
    }
  );
});

// Test: Empty schema with no required fields
test("validateToolArguments accepts empty object with permissive schema", () => {
  const emptySchema = {
    type: "object",
    properties: {}
  };
  const value = {};
  const result = validateToolArguments(emptySchema, value);
  assert.deepEqual(result, value);
});

// Test: structuredClone behavior (verify value is not mutated and returns a copy)
test("validateToolArguments returns structured clone of valid value", () => {
  const value = { name: "Quinn" };
  const result = validateToolArguments(basicSchema, value);
  assert.deepEqual(result, value);
  assert.notStrictEqual(result, value); // Different object reference
  value.name = "Modified";
  assert.equal(result.name, "Quinn"); // Original modification doesn't affect result
});

// Test: Nested object (should not be validated recursively - only scalar types)
test("validateToolArguments does not validate nested objects", () => {
  const nestedSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
      metadata: { type: "object" }
    },
    required: ["name"]
  };
  const value = {
    name: "Rachel",
    metadata: { nested: "value", deep: { level: 3 } }
  };
  const result = validateToolArguments(nestedSchema, value);
  assert.deepEqual(result, value);
});

// Test: Boolean false and 0 distinction
test("validateToolArguments correctly distinguishes boolean false from 0", () => {
  const value = { name: "Sam", active: false };
  const result = validateToolArguments(basicSchema, value);
  assert.equal(result.active, false);
  assert.notEqual(result.active, 0);
});

// Test: Empty string is valid for string type
test("validateToolArguments accepts empty string for string field", () => {
  const value = { name: "" };
  const result = validateToolArguments(basicSchema, value);
  assert.deepEqual(result, value);
});

// Test: Zero is valid for number with minimum 0
test("validateToolArguments accepts zero for number with minimum 0", () => {
  const value = { name: "Tina", score: 0 };
  const result = validateToolArguments(basicSchema, value);
  assert.deepEqual(result, value);
});

// Test: Integer 0 is valid for integer with minimum 0
test("validateToolArguments accepts integer zero for integer with minimum 0", () => {
  const value = { name: "Uma", age: 0 };
  const result = validateToolArguments(basicSchema, value);
  assert.deepEqual(result, value);
});

// Test: Exact boundary values are valid
test("validateToolArguments accepts exact minimum and maximum boundaries", () => {
  const value = { name: "Victor", age: 0, score: 100 };
  const result = validateToolArguments(basicSchema, value);
  assert.deepEqual(result, value);
});

// Test: Enum with first valid value
test("validateToolArguments accepts first enum value", () => {
  const value = { name: "Wendy", status: "pending" };
  const result = validateToolArguments(basicSchema, value);
  assert.deepEqual(result, value);
});

// Test: Enum with last valid value
test("validateToolArguments accepts last enum value", () => {
  const value = { name: "Xavier", status: "rejected" };
  const result = validateToolArguments(basicSchema, value);
  assert.deepEqual(result, value);
});

// Test: Schema without properties
test("validateToolArguments handles schema without properties field", () => {
  const minimalSchema = {
    type: "object"
  };
  const value = { name: "Yara" };
  const result = validateToolArguments(minimalSchema, value, { rejectUnknown: false });
  assert.deepEqual(result, value);
});

// Test: Schema without required fields
test("validateToolArguments handles schema without required field", () => {
  const optionalSchema = {
    type: "object",
    properties: {
      name: { type: "string" }
    }
  };
  const value = {};
  const result = validateToolArguments(optionalSchema, value);
  assert.deepEqual(result, value);
});

// Test: Type coercion is NOT performed (e.g., "123" is not coerced to 123)
test("validateToolArguments does not coerce string number to integer", () => {
  const value = { name: "Zoe", age: "123" };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      return true;
    }
  );
});

// Test: Negative infinity
test("validateToolArguments rejects negative Infinity for number field", () => {
  const value = { name: "Abe", score: -Infinity };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.match(err.details[0].reason, /expected finite number/);
      return true;
    }
  );
});

// Test: Large valid number within bounds
test("validateToolArguments accepts large number within maximum bound", () => {
  const value = { name: "Beth", score: 99.99999 };
  const result = validateToolArguments(basicSchema, value);
  assert.deepEqual(result, value);
});

// Test: Complex error scenario with missing required and unknown fields
test("validateToolArguments reports missing required and unknown fields together", () => {
  const value = { unknown1: "a", unknown2: "b" };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.ok(err.details.length >= 3); // at least name (required), unknown1, unknown2
      const names = err.details.filter(d => d.path === "$.name");
      assert.equal(names.length, 1);
      assert.equal(names[0].reason, "required");
      return true;
    }
  );
});

// Test: Enum with boolean values
test("validateToolArguments validates enum with heterogeneous types", () => {
  const enumSchema = {
    type: "object",
    properties: {
      value: { type: "string", enum: ["yes", "no", "maybe"] }
    },
    required: ["value"]
  };
  const validValue = { value: "yes" };
  const result = validateToolArguments(enumSchema, validValue);
  assert.deepEqual(result, validValue);

  const invalidValue = { value: "perhaps" };
  assert.throws(
    () => validateToolArguments(enumSchema, invalidValue),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      return true;
    }
  );
});

// Test: Null value within object (not the root)
test("validateToolArguments rejects null as property value", () => {
  const value = { name: null };
  assert.throws(
    () => validateToolArguments(basicSchema, value),
    (err) => {
      assert.ok(err instanceof ToolArgumentValidationError);
      assert.equal(err.details[0].path, "$.name");
      return true;
    }
  );
});

// Test: ToolArgumentValidationError properties are set correctly
test("ToolArgumentValidationError has correct properties", () => {
  const error = new ToolArgumentValidationError("test message", [
    { path: "$.field", reason: "test reason" }
  ]);
  assert.equal(error.name, "ToolArgumentValidationError");
  assert.equal(error.code, "INVALID_TOOL_ARGUMENTS");
  assert.equal(error.status, 422);
  assert.equal(error.message, "test message");
  assert.equal(error.details.length, 1);
  assert.equal(error.details[0].path, "$.field");
  assert.equal(error.details[0].reason, "test reason");
});

// Test: ToolArgumentValidationError extends Error properly
test("ToolArgumentValidationError is instanceof Error", () => {
  const error = new ToolArgumentValidationError("test");
  assert.ok(error instanceof Error);
  assert.ok(error instanceof ToolArgumentValidationError);
});
