const pool = require('../CQ_API/src/db');
const { initializeApplicationSchema } = require('../CQ_API/src/dbInit');
const { startDjlFullSync } = require('../CQ_API/src/djlSyncService');

async function main() {
  await initializeApplicationSchema(pool);
  const result = await startDjlFullSync(pool, {
    id: 0,
    name: 'cli',
    phone: 'cli',
  });
  console.log(JSON.stringify(result, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
