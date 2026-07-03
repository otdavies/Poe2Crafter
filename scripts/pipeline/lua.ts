/**
 * Convert Path of Building's auto-generated Lua data files to plain JS values.
 *
 * PoB data files are pure literals (`return { ... }`), so we parse with
 * luaparse and evaluate table constructors directly — no Lua runtime needed.
 */
import { parse } from "luaparse";
import type { Expression, TableConstructorExpression } from "luaparse";

export function parseLuaData(source: string): unknown {
  const ast = parse(source, { comments: false });
  const last = ast.body[ast.body.length - 1];
  if (last?.type !== "ReturnStatement" || last.arguments.length !== 1) {
    throw new Error("expected a Lua file ending in a single `return <table>`");
  }
  return evalExpression(last.arguments[0]);
}

function evalExpression(node: Expression): unknown {
  switch (node.type) {
    case "StringLiteral": {
      // luaparse types .value as string but it can be null at runtime,
      // in which case .raw (with quotes) is authoritative
      const literal = node as { value: string | null; raw: string };
      return literal.value ?? unquote(literal.raw);
    }
    case "NumericLiteral":
      return node.value;
    case "BooleanLiteral":
      return node.value;
    case "NilLiteral":
      return null;
    case "UnaryExpression":
      if (node.operator === "-") return -(evalExpression(node.argument) as number);
      throw new Error(`unsupported unary operator ${node.operator}`);
    case "TableConstructorExpression":
      return evalTable(node);
    default:
      throw new Error(`unsupported Lua expression: ${node.type}`);
  }
}

function evalTable(node: TableConstructorExpression): unknown {
  const arrayValues: unknown[] = [];
  const record: Record<string, unknown> = {};
  let recordKeys = 0;

  for (const field of node.fields) {
    switch (field.type) {
      case "TableValue":
        arrayValues.push(evalExpression(field.value));
        break;
      case "TableKeyString":
        record[field.key.name] = evalExpression(field.value);
        recordKeys++;
        break;
      case "TableKey": {
        const key = evalExpression(field.key);
        record[String(key)] = evalExpression(field.value);
        recordKeys++;
        break;
      }
    }
  }

  if (recordKeys === 0) return arrayValues;
  if (arrayValues.length === 0) return record;
  // Mixed tables (array part + keyed part) — PoB uses these for mod lists
  // with attached metadata. Represent the array part under a reserved key.
  return { ...record, __items: arrayValues };
}

function unquote(raw: string): string {
  const body = raw.slice(1, -1);
  return body.replace(/\\(.)/g, (_, ch: string) => {
    const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r" };
    return escapes[ch] ?? ch;
  });
}
