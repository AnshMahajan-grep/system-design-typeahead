// Tiny structured logger so the demo console is readable and grep-able.
// Format: [ISO time] LEVEL message {json}
function log(level, msg, extra) {
  const line = `[${new Date().toISOString()}] ${level} ${msg}`;
  if (extra !== undefined) console.log(line, JSON.stringify(extra));
  else console.log(line);
}

export const logger = {
  info: (msg, extra) => log('INFO ', msg, extra),
  warn: (msg, extra) => log('WARN ', msg, extra),
  error: (msg, extra) => log('ERROR', msg, extra),
};
