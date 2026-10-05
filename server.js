/**
 * NSTS.E — Online Backend (Supabase + Gemini)
 * Pure Node.js — no npm install required.
 *
 * Required environment variables:
 *   SUPABASE_URL
 *   SUPABASE_PUBLISHABLE_KEY
 *   GEMINI_API_KEY
 *
 * Optional:
 *   PORT
 *   GEMINI_MODEL
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = process.env.PORT || 5000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const AI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const MAX_BODY_BYTES = 50 * 1024 * 1024;

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

function supabaseReady() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

async function supabaseRequest(table, options = {}) {
  if (!supabaseReady()) {
    const err = new Error('Supabase is not configured.');
    err.code = 'SUPABASE_NOT_CONFIGURED';
    throw err;
  }

  const url = `${SUPABASE_URL}/rest/v1/${table}${options.query || ''}`;

  const headers = {
    apikey: SUPABASE_KEY,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const err = new Error(
      typeof data === 'object' && data?.message
        ? data.message
        : `Supabase request failed (${response.status}).`
    );

    err.status = response.status;
    err.details = data;

    throw err;
  }

  return data;
}

function normalizeTest(row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    timeLimit: row.time_limit,
    questions: Array.isArray(row.questions) ? row.questions : [],
    createdAt: row.created_at,
    teacherCode: row.teacher_code,
  };
}

function normalizeResult(row) {
  return {
    id: row.id,
    testId: row.test_id,
    testTitle: row.test_title,
    studentName: row.student_name,
    score: row.score,
    total: row.total,
    detail: Array.isArray(row.detail) ? row.detail : [],
    submittedAt: row.submitted_at,
  };
}

function generateCode(existingCodes) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let code;

  do {
    code = Array.from(
      { length: 6 },
      () => alphabet[crypto.randomInt(alphabet.length)]
    ).join('');
  } while (existingCodes.includes(code));

  return code;
}

async function getAllTests() {
  const rows = await supabaseRequest('tests', {
    query: '?select=*&order=created_at.desc',
  });

  return rows.map(normalizeTest);
}

async function getTestsForTeacher(teacherCode) {
  const rows = await supabaseRequest('tests', {
    query: `?select=*&teacher_code=eq.${encodeURIComponent(teacherCode)}&order=created_at.desc`,
  });

  return rows.map(normalizeTest);
}

async function getTestById(id) {
  const rows = await supabaseRequest('tests', {
    query: `?select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  });

  return rows[0] ? normalizeTest(rows[0]) : null;
}

async function getTestByCode(code) {
  const rows = await supabaseRequest('tests', {
    query: `?select=*&code=eq.${encodeURIComponent(code)}&limit=1`,
  });

  return rows[0] ? normalizeTest(rows[0]) : null;
}

async function getTeacherFromRequest(req) {
  const code = String(req.headers['x-teacher-code'] || '').trim().toUpperCase();

  if (!code) return null;

  const rows = await supabaseRequest('teachers', {
    query: `?select=*&code=eq.${encodeURIComponent(code)}&limit=1`,
  });

  return rows[0] || null;
}

function sendJSON(res, statusCode, data) {
  const body = JSON.stringify(data);

  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
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
  const rel = urlPath === '/' ? '/index.html' : urlPath;

  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);

    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    });

    res.end(content);
  });
}

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
    if (!supabaseReady() && pathname.startsWith('/api/')) {
      return sendJSON(res, 500, {
        error:
          'Supabase is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY, then restart the server.',
      });
    }

    // --------------------------------------------------
    // TEACHER AUTHENTICATION
    // --------------------------------------------------

    const isTeacherRoute =
      (pathname === '/api/tests' && (req.method === 'GET' || req.method === 'POST')) ||
      (/^\/api\/tests\/[A-Za-z0-9-]+$/.test(pathname) && req.method === 'DELETE') ||
      /^\/api\/results\//.test(pathname) ||
      pathname === '/api/teacher/me' ||
      pathname === '/api/generate-questions' ||
      pathname === '/api/extract-questions';

    let teacher = null;

    if (isTeacherRoute) {
      teacher = await getTeacherFromRequest(req);

      if (!teacher) {
        return sendJSON(res, 401, {
          error: 'Invalid or missing teacher code.',
        });
      }
    }

    if (pathname === '/api/teacher/me' && req.method === 'GET') {
      return sendJSON(res, 200, { name: teacher.name });
    }

    // --------------------------------------------------
    // CREATE TEST
    // --------------------------------------------------

    if (pathname === '/api/tests' && req.method === 'POST') {
      const body = await getRequestBody(req);

      if (
        !body.title ||
        !Array.isArray(body.questions) ||
        body.questions.length === 0
      ) {
        return sendJSON(res, 400, {
          error: 'A title and at least one question are required.',
        });
      }

      for (const q of body.questions) {
        if (!q.text || !Array.isArray(q.options) || q.options.length < 2) {
          return sendJSON(res, 400, {
            error: 'Every question needs text and at least 2 options.',
          });
        }

        if (
          typeof q.correctIndex !== 'number' ||
          q.correctIndex < 0 ||
          q.correctIndex >= q.options.length
        ) {
          return sendJSON(res, 400, {
            error: 'Every question needs a valid correct answer.',
          });
        }
      }

      const existingTests = await getAllTests();

      const newTest = {
        id: crypto.randomUUID(),

        code: generateCode(existingTests.map((t) => t.code)),

        title: String(body.title).slice(0, 200),

        timeLimit: Number(body.timeLimit) > 0 ? Number(body.timeLimit) : 20,

        questions: body.questions.map((q) => ({
          id: crypto.randomUUID(),
          text: String(q.text).slice(0, 2000),
          options: q.options.map((o) => String(o).slice(0, 500)),
          correctIndex: q.correctIndex,
        })),

        createdAt: new Date().toISOString(),
      };

      const rows = await supabaseRequest('tests', {
        method: 'POST',
        query: '?select=*',

        headers: {
          Prefer: 'return=representation',
        },

        body: {
          id: newTest.id,
          code: newTest.code,
          teacher_code: teacher.code,
          title: newTest.title,
          time_limit: newTest.timeLimit,
          questions: newTest.questions,
          created_at: newTest.createdAt,
        },
      });

      return sendJSON(res, 201, normalizeTest(rows[0]));
    }

    // --------------------------------------------------
    // LIST TESTS (only this teacher's)
    // --------------------------------------------------

    if (pathname === '/api/tests' && req.method === 'GET') {
      return sendJSON(res, 200, await getTestsForTeacher(teacher.code));
    }

    // --------------------------------------------------
    // DELETE TEST (only own tests)
    // --------------------------------------------------

    let m = pathname.match(/^\/api\/tests\/([A-Za-z0-9-]+)$/);

    if (m && req.method === 'DELETE') {
      const existing = await getTestById(m[1]);

      if (!existing || existing.teacherCode !== teacher.code) {
        return sendJSON(res, 404, {
          error: 'Test not found.',
        });
      }

      await supabaseRequest('tests', {
        method: 'DELETE',
        query: `?id=eq.${encodeURIComponent(m[1])}`,
      });

      return sendJSON(res, 200, {
        success: true,
      });
    }

    // --------------------------------------------------
    // STUDENT GET TEST BY CODE
    // --------------------------------------------------

    m = pathname.match(/^\/api\/tests\/code\/([A-Za-z0-9]+)$/);

    if (m && req.method === 'GET') {
      const test = await getTestByCode(m[1].toUpperCase());

      if (!test) {
        return sendJSON(res, 404, {
          error: 'No test found with that code.',
        });
      }

      // IMPORTANT:
      // Correct answers are removed before
      // sending the test to the student.

      const safeTest = {
        id: test.id,
        code: test.code,
        title: test.title,
        timeLimit: test.timeLimit,

        questions: test.questions.map((q) => ({
          id: q.id,
          text: q.text,
          options: q.options,
        })),
      };

      return sendJSON(res, 200, safeTest);
    }

    // --------------------------------------------------
    // SUBMIT ANSWERS
    // --------------------------------------------------

    if (pathname === '/api/submit' && req.method === 'POST') {
      const body = await getRequestBody(req);

      const { testId, studentName, answers } = body;

      if (!testId || !studentName || typeof answers !== 'object') {
        return sendJSON(res, 400, {
          error: 'Missing test, name, or answers.',
        });
      }

      const test = await getTestById(testId);

      if (!test) {
        return sendJSON(res, 404, {
          error: 'Test not found.',
        });
      }

      let score = 0;

      const detail = test.questions.map((q) => {
        const given = answers[q.id];

        const correct = given === q.correctIndex;

        if (correct) {
          score++;
        }

        return {
          questionId: q.id,
          questionText: q.text,
          given,
          correctIndex: q.correctIndex,
          correct,
        };
      });

      const result = {
        id: crypto.randomUUID(),
        testId,
        testTitle: test.title,
        studentName: String(studentName).slice(0, 200),
        score,
        total: test.questions.length,
        detail,
        submittedAt: new Date().toISOString(),
      };

      await supabaseRequest('results', {
        method: 'POST',

        headers: {
          Prefer: 'return=minimal',
        },

        body: {
          id: result.id,
          test_id: result.testId,
          test_title: result.testTitle,
          student_name: result.studentName,
          score: result.score,
          total: result.total,
          detail: result.detail,
          submitted_at: result.submittedAt,
        },
      });

      return sendJSON(res, 201, {
        score,
        total: test.questions.length,
      });
    }

    // --------------------------------------------------
    // RESULTS FOR ONE TEST (only own tests)
    // --------------------------------------------------

    m = pathname.match(/^\/api\/results\/([A-Za-z0-9-]+)$/);

    if (m && req.method === 'GET') {
      const ownedTest = await getTestById(m[1]);

      if (!ownedTest || ownedTest.teacherCode !== teacher.code) {
        return sendJSON(res, 404, { error: 'Test not found.' });
      }

      const rows = await supabaseRequest('results', {
        query: `?select=*&test_id=eq.${encodeURIComponent(m[1])}&order=submitted_at.desc`,
      });

      return sendJSON(res, 200, rows.map(normalizeResult));
    }

    // --------------------------------------------------
    // AI STATUS
    // --------------------------------------------------

    if (pathname === '/api/ai-status' && req.method === 'GET') {
      return sendJSON(res, 200, {
        available: Boolean(getApiKey()),
        provider: 'Google Gemini',
      });
    }

    // --------------------------------------------------
    // GENERATE QUESTIONS WITH GEMINI
    // --------------------------------------------------

    if (pathname === '/api/generate-questions' && req.method === 'POST') {
      const apiKey = getApiKey();

      if (!apiKey) {
        return sendJSON(res, 400, {
          error:
            'No Gemini API key configured. Set GEMINI_API_KEY and restart the server.',
        });
      }

      const body = await getRequestBody(req);

      const images = Array.isArray(body.images) ? body.images : [];

      const numQuestions = Math.min(
        Math.max(parseInt(body.numQuestions, 10) || 5, 1),
        15
      );

      const context = body.context ? String(body.context).slice(0, 500) : '';

      if (images.length === 0) {
        return sendJSON(res, 400, {
          error: 'Upload at least one image of the material.',
        });
      }

      if (images.length > 5) {
        return sendJSON(res, 400, {
          error: 'Please upload 5 images or fewer at a time.',
        });
      }

      const allowedImageTypes = new Set([
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ]);

      for (const img of images) {
        if (!img || typeof img.data !== 'string' || !img.data) {
          return sendJSON(res, 400, {
            error: 'One of the uploaded images is invalid.',
          });
        }

        if (!allowedImageTypes.has(img.mediaType)) {
          return sendJSON(res, 400, {
            error: 'Unsupported image type. Use JPEG, PNG, GIF, or WebP.',
          });
        }
      }

      const contents = [
        ...images.map((img) => ({
          inline_data: {
            mime_type: img.mediaType,
            data: img.data,
          },
        })),

        {
          text:
            `Generate exactly ${numQuestions} multiple-choice questions based strictly on the ` +
            `material shown in the attached image(s). ` +
            `${context ? 'Focus area: ' + context + '. ' : ''}` +
            `Each question must have exactly 4 answer options with only one correct answer. ` +
            `Vary difficulty and cover different parts of the material. ` +
            `Respond with ONLY a raw JSON array (no markdown fences, no commentary) in this exact shape: ` +
            `[{"text":"question text","options":["a","b","c","d"],"correctIndex":0}]`,
        },
      ];

      let aiRes;

      try {
        aiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            AI_MODEL
          )}:generateContent`,

          {
            method: 'POST',

            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },

            body: JSON.stringify({
              contents: [
                {
                  role: 'user',
                  parts: contents,
                },
              ],

              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.4,
              },
            }),
          }
        );
      } catch {
        return sendJSON(res, 502, {
          error:
            'Could not reach Google Gemini. Check the internet connection on this computer.',
        });
      }

      if (!aiRes.ok) {
        const errBody = await aiRes.text();

        let message = `Gemini returned an error (status ${aiRes.status}).`;

        if (aiRes.status === 400) {
          message =
            'Gemini rejected the request. Check the uploaded images and API key/model settings.';
        }

        if (aiRes.status === 401 || aiRes.status === 403) {
          message =
            'The Gemini API key was rejected. Create/check your key in Google AI Studio.';
        }

        if (aiRes.status === 429) {
          message =
            'The free Gemini limit has been reached temporarily. Try again later.';
        }

        console.error('Gemini API error:', aiRes.status, errBody);

        return sendJSON(res, 502, {
          error: message,
        });
      }

      const aiData = await aiRes.json();

      const raw = aiData?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || '')
        .join('')
        .trim();

      if (!raw) {
        return sendJSON(res, 502, {
          error: 'Gemini response did not contain any text.',
        });
      }

      let parsed;

      try {
        parsed = JSON.parse(
          raw
            .replace(/^```(?:json)?/i, '')
            .replace(/```$/, '')
            .trim()
        );
      } catch {
        return sendJSON(res, 502, {
          error: 'Gemini response was not valid JSON. Try again.',
        });
      }

      if (!Array.isArray(parsed)) {
        return sendJSON(res, 502, {
          error: 'Gemini response was not in the expected format.',
        });
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
          text: String(q.text).slice(0, 2000),
          options: q.options.map((o) => String(o).slice(0, 500)),
          correctIndex: q.correctIndex,
        }));

      if (questions.length === 0) {
        return sendJSON(res, 502, {
          error:
            'Gemini did not return any usable questions. Try clearer images or fewer questions.',
        });
      }

      return sendJSON(res, 200, {
        questions,
      });
    }

    // --------------------------------------------------
    // IMPORT QUESTIONS FROM AN EXISTING TEST FILE
    // --------------------------------------------------

    if (pathname === '/api/extract-questions' && req.method === 'POST') {
      const apiKey = getApiKey();

      if (!apiKey) {
        return sendJSON(res, 400, {
          error:
            'No Gemini API key configured. Set GEMINI_API_KEY and restart the server.',
        });
      }

      const body = await getRequestBody(req);

      let filePart;

      if (typeof body.text === 'string' && body.text.trim()) {
        filePart = {
          text:
            'TEST FILE CONTENT (' + String(body.fileName || 'file').slice(0, 100) + '):\n\n' +
            body.text.slice(0, 300000),
        };
      } else if (typeof body.data === 'string' && body.data) {
        const okTypes = new Set([
          'application/pdf',
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
        ]);

        if (!okTypes.has(body.mediaType)) {
          return sendJSON(res, 400, {
            error: 'Unsupported file type. Use HTML, TXT, JSON, CSV, PDF or an image.',
          });
        }

        filePart = {
          inline_data: { mime_type: body.mediaType, data: body.data },
        };
      } else {
        return sendJSON(res, 400, {
          error: 'Upload a test file first.',
        });
      }

      const prompt =
        'The attached file is an existing multiple-choice test written by a teacher. ' +
        'Extract EVERY multiple-choice question from it exactly as written. ' +
        'Do not invent, reword, merge, reorder or skip any question or option. ' +
        'If the file contains the correct answers (for example an answer key, marked answers, or an index in code such as "a:1" meaning the second option), ' +
        'use them. Indexes in code are zero-based. If no answers are given, choose the most likely correct option. ' +
        'Respond with ONLY a raw JSON array (no markdown fences, no commentary) in this exact shape: ' +
        '[{"text":"question text","options":["a","b","c","d"],"correctIndex":0}]';

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
              contents: [{ role: 'user', parts: [filePart, { text: prompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0,
                maxOutputTokens: 30000,
              },
            }),
          }
        );
      } catch {
        return sendJSON(res, 502, {
          error: 'Could not reach Google Gemini. Check the internet connection on this computer.',
        });
      }

      if (!aiRes.ok) {
        const errBody = await aiRes.text();
        console.error('Gemini API error:', aiRes.status, errBody);

        let message = `Gemini returned an error (status ${aiRes.status}).`;
        if (aiRes.status === 400) message = 'Gemini rejected the file. Try a different file or format.';
        if (aiRes.status === 401 || aiRes.status === 403) message = 'The Gemini API key was rejected.';
        if (aiRes.status === 429) message = 'The free Gemini limit has been reached temporarily. Try again later.';

        return sendJSON(res, 502, { error: message });
      }

      const aiData = await aiRes.json();

      const raw = aiData?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || '')
        .join('')
        .trim();

      if (!raw) {
        return sendJSON(res, 502, { error: 'Gemini response did not contain any text.' });
      }

      let parsed;

      try {
        parsed = JSON.parse(
          raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
        );
      } catch {
        return sendJSON(res, 502, { error: 'Gemini response was not valid JSON. Try again.' });
      }

      if (!Array.isArray(parsed)) {
        return sendJSON(res, 502, { error: 'Gemini response was not in the expected format.' });
      }

      const extracted = parsed
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
        .slice(0, 200)
        .map((q) => ({
          text: String(q.text).slice(0, 2000),
          options: q.options.map((o) => String(o).slice(0, 500)),
          correctIndex: q.correctIndex,
        }));

      if (extracted.length === 0) {
        return sendJSON(res, 502, {
          error: 'No multiple-choice questions could be found in that file.',
        });
      }

      return sendJSON(res, 200, { questions: extracted });
    }

    // --------------------------------------------------
    // STATIC FRONTEND
    // --------------------------------------------------

    if (req.method === 'GET') {
      return serveStatic(req, res, pathname);
    }

    return sendJSON(res, 404, {
      error: 'Not found.',
    });
  } catch (err) {
    console.error(err);

    if (err.code === 'PAYLOAD_TOO_LARGE') {
      return sendJSON(res, 413, {
        error:
          'Request is too large. Reduce the number or size of images and try again.',
      });
    }

    if (err.code === 'INVALID_JSON') {
      return sendJSON(res, 400, {
        error: 'Invalid JSON request.',
      });
    }

    if (err.code === 'SUPABASE_NOT_CONFIGURED') {
      return sendJSON(res, 500, {
        error:
          'Supabase is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.',
      });
    }

    return sendJSON(res, 500, {
      error: 'Server error. Check the Node.js console for details.',
    });
  }
});

function getLocalIPs() {
  const nets = os.networkInterfaces();

  const ips = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }

  return ips;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('='.repeat(50));

  console.log('NSTS.E Online Backend is running');

  console.log('='.repeat(50));

  console.log(`On this computer:      http://localhost:${PORT}`);

  const ips = getLocalIPs();

  if (ips.length) {
    console.log('From other devices on the same WiFi/network:');

    ips.forEach((ip) => console.log(`  http://${ip}:${PORT}`));
  }

  console.log('='.repeat(50));

  console.log(supabaseReady() ? 'Supabase: CONFIGURED' : 'Supabase: NOT CONFIGURED');

  console.log(
    getApiKey()
      ? 'AI question generation: ENABLED'
      : 'AI question generation: not configured'
  );

  console.log('='.repeat(50));
});
