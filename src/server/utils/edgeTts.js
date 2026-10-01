// Minimal client for Microsoft Edge's neural "Read Aloud" text-to-speech
// service — free, no API key, genuinely natural-sounding voices.
//
// This used to depend on the npm package `msedge-tts`, which ships a
// `"preinstall": "npx only-allow pnpm"` script in its OWN package.json —
// that script runs (and fails) during `npm install` of ANY project that
// depends on it, since npm isn't pnpm. It happened to succeed on this
// developer's machine but broke the Render build outright. Rather than
// fight that package's install behavior, the small amount of actual
// protocol logic needed is vendored here instead (same approach
// msedge-tts itself uses, MIT-licensed, github.com/Migushthe2nd/MsEdgeTTS)
// — no dependency whose install can break the build again for reasons
// unrelated to our own code.
//
// Protocol: open a secure WebSocket to Microsoft's speech synthesis
// endpoint, send a short JSON "speech config" message, then one SSML
// request; audio comes back as binary WebSocket frames each prefixed with
// a short text header, ending with a "Path:turn.end" text message. This is
// the same reverse-engineered protocol every "free Edge TTS" tool
// (including Python's popular `edge-tts` package) uses — there is no
// official public API for it, so it could need revisiting if Microsoft
// changes it.
const WebSocket = require('ws');
const crypto = require('crypto');

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const JSON_XML_DELIM = '\r\n\r\n';
const AUDIO_DELIM = 'Path:audio\r\n';
const REQUEST_TIMEOUT_MS = 10000;

// Microsoft rate-limits this endpoint by a token derived from the current
// 5-minute window — this must match what Edge itself computes or the
// connection is rejected.
function generateSecMsGec() {
  const ticks = Math.floor(Date.now() / 1000) + 11644473600;
  const rounded = ticks - (ticks % 300);
  const windowsTicks = rounded * 10000000;
  return crypto.createHash('sha256').update(`${windowsTicks}${TRUSTED_CLIENT_TOKEN}`).digest('hex').toUpperCase();
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

// No escaping happens anywhere else in this module — the text is
// interpolated directly into an XML document, so a name containing &, <,
// or > would otherwise break the request or be interpreted as markup.
function escapeForSSML(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Synthesize `text` as speech using a Microsoft Edge neural voice.
 * @param {string} text
 * @param {string} voice e.g. 'en-US-GuyNeural' — locale is inferred from it
 * @param {string} outputFormat e.g. 'audio-24khz-96kbitrate-mono-mp3'
 * @returns {Promise<Buffer>}
 */
function synthesize(text, voice, outputFormat = 'audio-24khz-96kbitrate-mono-mp3') {
  return new Promise((resolve, reject) => {
    const locale = /\w{2}-\w{2}/.exec(voice)?.[0];
    if (!locale) { reject(new Error(`Could not infer a locale from voice "${voice}"`)); return; }

    const connectionId = randomHex(16);
    const url = `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${generateSecMsGec()}&Sec-MS-GEC-Version=1-143.0.3650.96&ConnectionId=${connectionId}`;

    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      },
    });

    const chunks = [];
    const requestId = randomHex(16);
    let settled = false;

    const timeout = setTimeout(() => finish(new Error('Edge TTS request timed out')), REQUEST_TIMEOUT_MS);

    function finish(err, buffer) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      ws.close();
      if (err) reject(err); else resolve(buffer);
    }

    ws.on('open', () => {
      ws.send(
        `Content-Type:application/json; charset=utf-8\r\nPath:speech.config${JSON_XML_DELIM}` +
        JSON.stringify({ context: { synthesis: { audio: { metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false }, outputFormat } } } })
      );
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">`
        + `<voice name="${voice}"><prosody pitch="+0Hz" rate="+0%" volume="+0%">${escapeForSSML(text)}</prosody></voice></speak>`;
      ws.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml${JSON_XML_DELIM}${ssml.trim()}`);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const headerEnd = data.indexOf(AUDIO_DELIM);
        if (headerEnd === -1) return;
        chunks.push(data.subarray(headerEnd + AUDIO_DELIM.length));
        return;
      }
      if (data.toString().includes('Path:turn.end')) {
        finish(null, Buffer.concat(chunks));
      }
    });

    ws.on('error', (err) => finish(new Error(`Edge TTS WebSocket error: ${err.message}`)));
    ws.on('close', () => finish(new Error('Edge TTS connection closed before synthesis completed')));
  });
}

module.exports = { synthesize };
