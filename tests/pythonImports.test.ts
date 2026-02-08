import test from "node:test";
import assert from "node:assert/strict";
import { parsePythonImports } from "../src/parsers/pythonImports.js";

test("parsePythonImports extracts import and from-import modules", () => {
  const source = `
import os, sys as s
from fastapi import FastAPI
from .core import app
# import ignored
`;

  const modules = parsePythonImports(source).sort();
  assert.deepEqual(modules, [".core", "fastapi", "os", "sys"].sort());
});
