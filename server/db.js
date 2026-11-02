const { Pool, types } = require("pg");

// Return DATE columns as plain YYYY-MM-DD strings (no timezone shifting)
types.setTypeParser(1082, (v) => v);
// Return NUMERIC as JS numbers
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Create a .env file (see .env.example) or set it on your server.");
}
const connectionString = process.env.DATABASE_URL || "postgresql://postgres@localhost:5432/iptas";
const needsSsl = /sslmode=require|neon\.tech|render\.com|supabase/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : false,
  max: 5,
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
