const mysql = require('mysql2/promise');
const { db } = require('../src/config');
const { initializeApplicationSchema } = require('../src/dbInit');

async function initDatabase() {
  const connection = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    charset: 'utf8mb4',
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${db.database}\` DEFAULT CHARACTER SET utf8mb4`);
  await connection.query(`USE \`${db.database}\``);
  await initializeApplicationSchema(connection);
  await connection.end();

  console.log(`Database ${db.database} initialized`);
}

initDatabase().catch((error) => {
  console.error('Database initialization failed:', error.message);
  process.exit(1);
});
