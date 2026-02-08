import { helper } from "./util.js";

const apiBase = process.env.API_BASE_URL || "http://localhost:3000";
console.log(helper(apiBase));
