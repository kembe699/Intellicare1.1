require('dotenv').config();
const { Sequelize } = require('sequelize');
// Connection details come from the environment — never hardcode credentials.
const sequelize = new Sequelize(
  process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD,
  { host: process.env.DB_HOST || '127.0.0.1', port: process.env.DB_PORT || 5432, dialect: 'postgres' },
);

async function fixVitals() {
  const [rows] = await sequelize.query("SELECT id, vitals FROM visits WHERE vitals IS NOT NULL AND vitals != ''");
  let fixed = 0;
  for (const row of rows) {
    try {
      JSON.parse(row.vitals);
    } catch (e) {
      let v = row.vitals;
      // Convert unquoted keys to quoted keys
      v = v.replace(/([a-zA-Z0-9_]+):/g, '"$1":');
      // Convert single quotes to double quotes if any
      v = v.replace(/'/g, '"');
      try {
        JSON.parse(v);
        await sequelize.query("UPDATE visits SET vitals = ? WHERE id = ?", { replacements: [v, row.id] });
        fixed++;
      } catch (err) {
        console.log("Could not fix", row.id, v);
      }
    }
  }
  console.log("Fixed", fixed, "records");
  process.exit();
}
fixVitals();
