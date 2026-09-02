require('dotenv').config();
const { Sequelize } = require('sequelize');
const seq = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  logging: false
});
(async () => {
  const [rows] = await seq.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  console.log('\nExisting tables (' + rows.length + '):');
  rows.forEach(r => console.log(' -', r.tablename));
  await seq.close();
})();
