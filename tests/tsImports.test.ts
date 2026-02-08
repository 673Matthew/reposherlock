import test from "node:test";
import assert from "node:assert/strict";
import { parseTsImports } from "../src/parsers/tsImports.js";

test("parseTsImports extracts import, require and dynamic import specifiers", () => {
  const source = `
import fs from "node:fs";
import {x} from './core';
import './side-effect';
const pkg = require("pkg-a");
const dyn = import('./dyn/mod');
`;

  const imports = parseTsImports(source).sort();
  assert.deepEqual(imports, ["./core", "./dyn/mod", "./side-effect", "node:fs", "pkg-a"].sort());
});
