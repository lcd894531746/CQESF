const path = require('path');
const { execFile } = require('child_process');
const { projectRoot } = require('./config');

const SCRIPT_PATH = path.join(
  projectRoot,
  '贝壳-数据采集',
  'scripts',
  'query_beike_community_price.py'
);

function toBoolean(value) {
  const raw = String(value || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function queryBeikeCommunityPrice(options = {}) {
  const communityName = String(options.communityName || '').trim();
  const resblockId = String(options.resblockId || '').trim();
  const houseCode = String(options.houseCode || '').trim();
  const live = toBoolean(options.live);

  if (!communityName) {
    const error = new Error('communityName is required');
    error.statusCode = 400;
    throw error;
  }

  const args = [SCRIPT_PATH, communityName];
  if (resblockId) args.push('--resblock-id', resblockId);
  if (houseCode) args.push('--house-code', houseCode);
  if (live) args.push('--live');

  const hookSeconds = Number(options.hookSeconds);
  if (Number.isFinite(hookSeconds) && hookSeconds > 0) {
    args.push('--hook-seconds', String(Math.floor(hookSeconds)));
  }

  try {
    const { stdout } = await execFileAsync('python', args, {
      cwd: projectRoot,
      timeout: live ? 180000 : 30000,
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf8',
    });
    return JSON.parse(stdout);
  } catch (error) {
    const stderrText = String(error.stderr || '').trim();
    const stdoutText = String(error.stdout || '').trim();
    const message = stderrText || stdoutText || error.message || 'query beike community price failed';
    const wrapped = new Error(message);
    wrapped.statusCode = live ? 502 : 500;
    throw wrapped;
  }
}

module.exports = {
  queryBeikeCommunityPrice,
};
