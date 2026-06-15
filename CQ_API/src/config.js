const path = require('path');
require('dotenv').config({ override: true });

const uploadDir = process.env.UPLOAD_DIR || 'uploads';
const appRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(appRoot, '..');

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return undefined;
}

module.exports = {
  port: Number(process.env.PORT || 9080),
  appRoot,
  projectRoot,
  imageCleanServiceBaseUrl: firstDefined(process.env.IMAGE_CLEAN_SERVICE_BASE_URL, 'http://127.0.0.1:5000'),
  db: {
    host: firstDefined(process.env.DB_HOST, process.env.MYSQL_HOST, '152.136.108.55'),
    port: Number(firstDefined(process.env.DB_PORT, process.env.MYSQL_PORT, 3306)),
    user: firstDefined(process.env.DB_USER, process.env.MYSQL_USER, 'root'),
    password: firstDefined(process.env.DB_PASSWORD, process.env.MYSQL_PASSWORD, ''),
    database: firstDefined(process.env.DB_NAME, process.env.MYSQL_DATABASE, 'cq_house'),
    timezone: '+08:00',
    waitForConnections: true,
    connectionLimit: Number(firstDefined(process.env.DB_CONNECTION_LIMIT, process.env.MYSQL_CONNECTION_LIMIT, 10)),
    queueLimit: 0,
    charset: 'utf8mb4',
  },
  uploadDir,
  uploadAbsoluteDir: path.resolve(appRoot, uploadDir),
  publicBaseUrl: firstDefined(process.env.PUBLIC_BASE_URL, process.env.APP_BASE_URL, ''),
  capturesDir: process.env.CAPTURES_DIR
    ? path.resolve(process.env.CAPTURES_DIR)
    : path.join(projectRoot, 'captures'),
  wechat: {
    appId: firstDefined(process.env.WECHAT_APP_ID, process.env.WX_APP_ID, process.env.MP_APP_ID, ''),
    appSecret: firstDefined(process.env.WECHAT_APP_SECRET, process.env.WX_APP_SECRET, process.env.MP_APP_SECRET, ''),
    qrCodeEnvVersion: firstDefined(process.env.WECHAT_QRCODE_ENV_VERSION, 'trial'),
  },
};
