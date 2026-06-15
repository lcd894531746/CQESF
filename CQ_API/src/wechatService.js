const https = require('https');
const { wechat } = require('./config');

let cachedAccessToken = '';
let cachedAccessTokenExpiresAt = 0;

function requestJson(urlText, options = {}, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText);
    const text = body ? JSON.stringify(body) : '';
    const request = https.request(url, {
      method: options.method || 'GET',
      headers: {
        ...(text ? {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(text),
        } : {}),
      },
      timeout: 30000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const responseText = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(responseText ? JSON.parse(responseText) : {});
        } catch (error) {
          reject(new Error(`Wechat API returned invalid JSON: ${error.message}`));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Wechat API timeout')));
    request.on('error', reject);
    request.end(text);
  });
}

async function getAccessToken() {
  if (!wechat.appId || !wechat.appSecret) {
    const error = new Error('Wechat appId/appSecret is not configured');
    error.statusCode = 501;
    throw error;
  }

  const now = Date.now();
  if (cachedAccessToken && cachedAccessTokenExpiresAt > now + 60000) {
    return cachedAccessToken;
  }

  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', wechat.appId);
  url.searchParams.set('secret', wechat.appSecret);

  const result = await requestJson(url.toString());
  if (!result.access_token) {
    throw new Error(`Wechat access token failed: ${result.errmsg || result.errcode || 'unknown error'}`);
  }

  cachedAccessToken = result.access_token;
  cachedAccessTokenExpiresAt = now + Number(result.expires_in || 7200) * 1000;
  return cachedAccessToken;
}

async function getPhoneNumberByCode(code) {
  if (!code) {
    const error = new Error('phone code is required');
    error.statusCode = 400;
    throw error;
  }

  const accessToken = await getAccessToken();
  const url = new URL('https://api.weixin.qq.com/wxa/business/getuserphonenumber');
  url.searchParams.set('access_token', accessToken);

  const result = await requestJson(url.toString(), { method: 'POST' }, { code });
  if (result.errcode && result.errcode !== 0) {
    throw new Error(`Wechat phone number failed: ${result.errmsg || result.errcode}`);
  }

  return result.phone_info || {};
}

async function code2Session(code) {
  if (!code) {
    const error = new Error('login code is required');
    error.statusCode = 400;
    throw error;
  }

  if (!wechat.appId || !wechat.appSecret) {
    const error = new Error('Wechat appId/appSecret is not configured');
    error.statusCode = 501;
    throw error;
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', wechat.appId);
  url.searchParams.set('secret', wechat.appSecret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const result = await requestJson(url.toString());
  if (result.errcode && result.errcode !== 0) {
    throw new Error(`Wechat login failed: ${result.errmsg || result.errcode}`);
  }

  return result;
}

async function getUnlimitedQRCode({ scene, page, checkPath = false, envVersion = 'release' }) {
  if (!scene) {
    const error = new Error('qrcode scene is required');
    error.statusCode = 400;
    throw error;
  }

  const accessToken = await getAccessToken();
  const url = new URL('https://api.weixin.qq.com/wxa/getwxacodeunlimit');
  url.searchParams.set('access_token', accessToken);

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      scene,
      page: page || 'pages/bind-staff/index',
      check_path: Boolean(checkPath),
      env_version: envVersion || 'release',
    });
    const request = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 30000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        if (contentType.includes('application/json')) {
          try {
            const result = JSON.parse(buffer.toString('utf8'));
            reject(new Error(`Wechat qrcode failed: ${result.errmsg || result.errcode || 'unknown error'}`));
          } catch (error) {
            reject(new Error(`Wechat qrcode invalid response: ${error.message}`));
          }
          return;
        }
        resolve(buffer);
      });
    });
    request.on('timeout', () => request.destroy(new Error('Wechat qrcode timeout')));
    request.on('error', reject);
    request.end(payload);
  });
}

module.exports = {
  getPhoneNumberByCode,
  code2Session,
  getUnlimitedQRCode,
};
