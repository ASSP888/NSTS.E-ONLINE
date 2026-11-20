/**
 * E-Testing System — Backend Server
 * Pure Node.js (no npm install required). Stores data in local JSON files.
 * Run with: node server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = process.env.PORT || 5000;
const DATA_DIR = path.join(__dirname, 'data');
const TESTS_FILE = path.join(DATA_DIR, 'tests.json');
const RESULTS_FILE = path.join(DATA_DIR, 'results.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const AI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB JSON request cap for compressed images

// ---------- AI config ----------
// Keep the Gemini key outside the project files. The browser never receives it.
// Set GEMINI_API_KEY in the server process environment before starting Node.
function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

// ---------- storage helpers ----------

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TESTS_FILE)) fs.writeFileSync(TESTS_FILE, '[]');
  if (!fs.existsSync(RESULTS_FILE)) fs.writeFileSync(RESULTS_FILE, '[]');
}
ensureDataFiles();

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}


function generateCode(existingCodes) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1 to avoid confusion
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (existingCodes.includes(code));
  return code;
}

// ---------- http helpers ----------

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (tooLarge) {
        const err = new Error('Request body is too large.');
        err.code = 'PAYLOAD_TOO_LARGE';
        return reject(err);
      }
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        const err = new Error('Invalid JSON request body.');
        err.code = 'INVALID_JSON';
        reject(err);
      }
    });

    req.on('error', reject);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
}

// ---------- request handler ----------

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host}`);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const pathname = decodeURIComponent(url.pathname);

  try {
    // Create a new test
    if (pathname === '/api/tests' && req.method === 'POST') {
      const body = await getRequestBody(req);

      if (!body.title || !Array.isArray(body.questions) || body.questions.length === 0) {
        return sendJSON(res, 400, { error: 'A title and at least one question are required.' });
      }
      for (const q of body.questions) {
        if (!q.text || !Array.isArray(q.options) || q.options.length < 2) {
          return sendJSON(res, 400, { error: 'Every question needs text and at least 2 options.' });
        }
        if (
          typeof q.correctIndex !== 'number' ||
          q.correctIndex < 0 ||
          q.correctIndex >= q.options.length
        ) {
          return sendJSON(res, 400, { error: 'Every question needs a valid correct answer.' });
        }
      }

      const tests = readJSON(TESTS_FILE);
      const newTest = {
        id: crypto.randomUUID(),
        code: generateCode(tests.map((t) => t.code)),
        title: String(body.title).slice(0, 200),
        timeLimit: Number(body.timeLimit) > 0 ? Number(body.timeLimit) : 20,
        shuffleQuestions: body.shuffleQuestions !== false,
        shuffleOptions: body.shuffleOptions === true,
        questions: body.questions.map((q) => ({
          id: crypto.randomUUID(),
          passage: q.passage ? String(q.passage).trim().slice(0, 10000) : '',
          text: String(q.text).slice(0, 2000),
          options: q.options.map((o) => String(o).slice(0, 500)),
          correctIndex: q.correctIndex,
        })),
        createdAt: new Date().toISOString(),
      };
      tests.push(newTest);
      writeJSON(TESTS_FILE, tests);
      return sendJSON(res, 201, newTest);
    }

    // List all tests (teacher dashboard — includes answers, for teacher's own use)
    if (pathname === '/api/tests' && req.method === 'GET') {
      const tests = readJSON(TESTS_FILE);
      return sendJSON(res, 200, tests);
    }

    // Delete a test
    let m = pathname.match(/^\/api\/tests\/([A-Za-z0-9-]+)$/);
    if (m && req.method === 'DELETE') {
      let tests = readJSON(TESTS_FILE);
      const before = tests.length;
      tests = tests.filter((t) => t.id !== m[1]);
      if (tests.length === before) return sendJSON(res, 404, { error: 'Test not found.' });
      writeJSON(TESTS_FILE, tests);
      return sendJSON(res, 200, { success: true });
    }

    // Fetch a test by its student-facing code (answers stripped)
    m = pathname.match(/^\/api\/tests\/code\/([A-Za-z0-9]+)$/);
    if (m && req.method === 'GET') {
      const code = m[1].toUpperCase();
      const tests = readJSON(TESTS_FILE);
      const test = tests.find((t) => t.code === code);
      if (!test) return sendJSON(res, 404, { error: 'No test found with that code.' });
      const safeTest = {
        id: test.id,
        code: test.code,
        title: test.title,
        timeLimit: test.timeLimit,
        shuffleQuestions: test.shuffleQuestions !== false,
        shuffleOptions: test.shuffleOptions === true,
        questions: test.questions.map((q) => ({
          id: q.id,
          passage: q.passage || '',
          text: q.text,
          options: q.options,
        })),
      };
      return sendJSON(res, 200, safeTest);
    }

    // Submit answers
    if (pathname === '/api/submit' && req.method === 'POST') {
      const body = await getRequestBody(req);
      const { testId, studentName, fatherName, answers } = body;
      if (!testId || !studentName || !fatherName || !answers || typeof answers !== 'object') {
        return sendJSON(res, 400, { error: 'Missing test, name, father name, or answers.' });
      }
      const tests = readJSON(TESTS_FILE);
      const test = tests.find((t) => t.id === testId);
      if (!test) return sendJSON(res, 404, { error: 'Test not found.' });

      let score = 0;
      const detail = test.questions.map((q) => {
        const given = answers[q.id];
        const correct = given === q.correctIndex;
        if (correct) score++;
        return { questionId: q.id, questionText: q.text, given, correctIndex: q.correctIndex, correct };
      });

      const results = readJSON(RESULTS_FILE);

      // One attempt per student (same name + father name) per test.
      const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const already = results.some(
        (r) =>
          r.testId === testId &&
          norm(r.studentName) === norm(studentName) &&
          norm(r.fatherName) === norm(fatherName)
      );
      if (already) {
        return sendJSON(res, 409, {
          error: 'A result for this student name and father name has already been submitted for this test.',
        });
      }

      const violations = Math.min(Math.max(parseInt(body.violations, 10) || 0, 0), 999);
      const submitReason = ['manual', 'time', 'violations'].includes(body.submitReason)
        ? body.submitReason
        : 'manual';

      const result = {
        id: crypto.randomUUID(),
        testId,
        testTitle: test.title,
        studentName: String(studentName).trim().slice(0, 200),
        fatherName: String(fatherName).trim().slice(0, 200),
        violations,
        submitReason,
        score,
        total: test.questions.length,
        detail,
        submittedAt: new Date().toISOString(),
      };
      results.push(result);
      writeJSON(RESULTS_FILE, results);
      return sendJSON(res, 201, { score, total: test.questions.length });
    }

    // Results for one test (teacher)
    m = pathname.match(/^\/api\/results\/([A-Za-z0-9-]+)$/);
    if (m && req.method === 'GET') {
      const results = readJSON(RESULTS_FILE);
      const filtered = results.filter((r) => r.testId === m[1]);
      return sendJSON(res, 200, filtered);
    }

    // Tell the frontend whether AI generation is configured
    if (pathname === '/api/ai-status' && req.method === 'GET') {
      return sendJSON(res, 200, { available: Boolean(getApiKey()), provider: 'Google Gemini' });
    }

    // Generate MCQ questions from uploaded images using the Google Gemini API.
    // The key remains server-side; the browser never receives it.
    if (pathname === '/api/generate-questions' && req.method === 'POST') {
      const apiKey = getApiKey();
      if (!apiKey) {
        return sendJSON(res, 400, {
          error: 'No Gemini API key configured. Set GEMINI_API_KEY in the server environment and restart the server (see README.md).',
        });
      }

      const body = await getRequestBody(req);
      const images = Array.isArray(body.images) ? body.images : [];
      const numQuestions = Math.min(Math.max(parseInt(body.numQuestions, 10) || 5, 1), 150);
      const context = body.context ? String(body.context).slice(0, 500) : '';

      if (images.length === 0) {
        return sendJSON(res, 400, { error: 'Upload at least one image of the material.' });
      }
      if (images.length > 5) {
        return sendJSON(res, 400, { error: 'Please upload 5 images or fewer at a time.' });
      }

      const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
      for (const img of images) {
        if (!img || typeof img.data !== 'string' || !img.data) {
          return sendJSON(res, 400, { error: 'One of the uploaded images is invalid.' });
        }
        if (!allowedImageTypes.has(img.mediaType)) {
          return sendJSON(res, 400, { error: 'Unsupported image type. Use JPEG, PNG, GIF, or WebP.' });
        }
      }

      const contents = [
        ...images.map((img) => ({
          inline_data: { mime_type: img.mediaType, data: img.data },
        })),
        {
          text:
            `You are helping a teacher build a multiple-choice test from the attached image(s).\n` +
            `${context ? 'Focus area: ' + context + '.\n' : ''}` +
            `RULES:\n` +
            `1. If the image(s) already contain printed multiple-choice questions, EXTRACT them exactly as written ` +
            `(up to ${numQuestions} questions) instead of inventing new ones. If an answer key is shown, use it; otherwise choose the correct answer yourself.\n` +
            `2. If the image(s) contain only study material, write exactly ${numQuestions} new questions based strictly on that material, ` +
            `each with 4 options and exactly one correct answer.\n` +
            `3. If a question depends on a reading passage / paragraph / comprehension text / poem / data table (for example "Read the paragraph and answer the following questions"), ` +
            `copy that passage in FULL into the "passage" field of EVERY question that depends on it (identical text each time). ` +
            `Do not summarise the passage. Use an empty string for "passage" when the question stands alone.\n` +
            `4. Do not include option letters such as "A)" or "(b)" inside the option text. The "text" field must not contain the passage.\n` +
            `Respond with ONLY a raw JSON array (no markdown fences, no commentary) in exactly this shape: ` +
            `[{"passage":"","text":"question text","options":["a","b","c","d"],"correctIndex":0}]`,
        },
      ];

      let aiRes;
      try {
        aiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(AI_MODEL)}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: contents }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.4,
              },
            }),
          }
        );
      } catch (err) {
        return sendJSON(res, 502, { error: 'Could not reach Google Gemini. Check the internet connection on this computer.' });
      }

      if (!aiRes.ok) {
        const errBody = await aiRes.text();
        let message = `Gemini returned an error (status ${aiRes.status}).`;
        if (aiRes.status === 400) message = 'Gemini rejected the request. Check the uploaded images and API key/model settings.';
        if (aiRes.status === 401 || aiRes.status === 403) message = 'The Gemini API key was rejected. Create/check your key in Google AI Studio.';
        if (aiRes.status === 429) message = 'The free Gemini limit has been reached temporarily. Try again later.';
        console.error('Gemini API error:', aiRes.status, errBody);
        return sendJSON(res, 502, { error: message });
      }

      const aiData = await aiRes.json();
      const raw = aiData?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
      if (!raw) {
        return sendJSON(res, 502, { error: 'Gemini response did not contain any text.' });
      }

      let parsed;
      try {
        parsed = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());
      } catch {
        return sendJSON(res, 502, { error: 'Gemini response was not valid JSON. Try again.' });
      }
      if (!Array.isArray(parsed)) {
        return sendJSON(res, 502, { error: 'Gemini response was not in the expected format.' });
      }

      const questions = parsed
        .filter(
          (q) =>
            q &&
            typeof q.text === 'string' &&
            Array.isArray(q.options) &&
            q.options.length >= 2 &&
            q.options.length <= 6 &&
            typeof q.correctIndex === 'number' &&
            q.correctIndex >= 0 &&
            q.correctIndex < q.options.length
        )
        .slice(0, numQuestions)
        .map((q) => ({
          passage: typeof q.passage === 'string' ? q.passage.trim().slice(0, 10000) : '',
          text: String(q.text).slice(0, 2000),
          options: q.options.map((o) => String(o).slice(0, 500)),
          correctIndex: q.correctIndex,
        }));

      if (questions.length === 0) {
        return sendJSON(res, 502, { error: 'Gemini did not return any usable questions. Try clearer images or fewer questions.' });
      }

      return sendJSON(res, 200, { questions });
    }

    // Static files
    if (req.method === 'GET') {
      return serveStatic(req, res, pathname);
    }

    sendJSON(res, 404, { error: 'Not found.' });
  } catch (err) {
    if (err.code === 'PAYLOAD_TOO_LARGE') {
      return sendJSON(res, 413, { error: 'Request is too large. Reduce the number or size of images and try again.' });
    }
    if (err.code === 'INVALID_JSON') {
      return sendJSON(res, 400, { error: 'Invalid JSON request.' });
    }
    console.error(err);
    sendJSON(res, 500, { error: 'Server error.' });
  }
});

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));
  console.log('E-Testing System is running');
  console.log('='.repeat(50));
  console.log(`On this computer:      http://localhost:${PORT}`);
  const ips = getLocalIPs();
  if (ips.length) {
    console.log('From other devices on the same WiFi/network:');
    ips.forEach((ip) => console.log(`  http://${ip}:${PORT}`));
  } else {
    console.log('Could not detect a local network IP — check your network connection.');
  }
  console.log('='.repeat(50));
  if (getApiKey()) {
    console.log('AI question generation: ENABLED');
  } else {
    console.log('AI question generation: not configured (see README.md to set GEMINI_API_KEY)');
  }
  console.log('='.repeat(50));
});
