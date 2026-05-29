const mysql = require('mysql2/promise');
const { db } = require('./config');

const pool = mysql.createPool(db);

module.exports = pool;
