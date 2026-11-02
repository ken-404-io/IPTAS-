// Loads variables from a .env file in the project folder (if it exists).
// Values already set in the environment (e.g. on Render) are not overwritten.
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", ".env");
if (fs.existsSync(file)) {
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
