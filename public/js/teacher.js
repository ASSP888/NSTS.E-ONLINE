// ---- teacher code / API helper ----
let teacherCode = localStorage.getItem('teacherCode') || '';

function api(url, options = {}) {
  options.headers = { ...(options.headers || {}), 'x-teacher-code': teacherCode };
  return fetch(url, options);
}

// ---- state ----
let qCounter = 0;
let questions = []; // { id, text, options: [string], correctIndex }

function newQuestion() {
  qCounter++;
  return {
    id: 'q' + qCounter,
    text: '',
    options: ['', '', '', ''],
    correctIndex: null,
  };
}

function addQuestion() {
  questions.push(newQuestion());
  renderQuestions();
}

function removeQuestion(qid) {
  questions = questions.filter((q) => q.id !== qid);
  renderQuestions();
}

function addOption(qid) {
  const q = questions.find((x) => x.id === qid);
  if (q.options.length >= 6) return;
  q.options.push('');
  renderQuestions();
}

function removeOption(qid, optIndex) {
  const q = questions.find((x) => x.id === qid);
  if (q.options.length <= 2) return;
  q.options.splice(optIndex, 1);
  if (q.correctIndex === optIndex) q.correctIndex = null;
  else if (q.correctIndex > optIndex) q.correctIndex--;
  renderQuestions();
}

function renderQuestions() {
  const container = document.getElementById('questionsContainer');
  container.innerHTML = '';

  questions.forEach((q, qi) => {
    const card = document.createElement('div');
    card.className = 'q-card';

    const head = document.createElement('div');
    head.className = 'q-head';
    head.innerHTML = `<span class="q-num">QUESTION ${qi + 1}</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-link';
    removeBtn.textContent = 'Remove question';
    removeBtn.onclick = () => removeQuestion(q.id);
    head.appendChild(removeBtn);
    card.appendChild(head);

    const textField = document.createElement('div');
    textField.className = 'field';
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.placeholder = 'Question text';
    textInput.value = q.text;
    textInput.oninput = (e) => (q.text = e.target.value);
    textField.appendChild(textInput);
    card.appendChild(textField);

    q.options.forEach((opt, oi) => {
      const row = document.createElement('div');
      row.className = 'opt-row';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'correct-' + q.id;
      radio.checked = q.correctIndex === oi;
      radio.title = 'Mark as correct answer';
      radio.onchange = () => (q.correctIndex = oi);
      row.appendChild(radio);

      const optInput = document.createElement('input');
      optInput.type = 'text';
      optInput.placeholder = 'Option ' + String.fromCharCode(65 + oi);
      optInput.value = opt;
      optInput.oninput = (e) => (q.options[oi] = e.target.value);
      row.appendChild(optInput);

      if (q.options.length > 2) {
        const rm = document.createElement('button');
        rm.className = 'remove-link';
        rm.textContent = '✕';
        rm.title = 'Remove option';
        rm.onclick = () => removeOption(q.id, oi);
        row.appendChild(rm);
      }

      card.appendChild(row);
    });

    if (q.options.length < 6) {
      const addOptBtn = document.createElement('button');
      addOptBtn.className = 'remove-link';
      addOptBtn.textContent = '+ Add option';
      addOptBtn.onclick = () => addOption(q.id);
      card.appendChild(addOptBtn);
    }

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.style.marginTop = '10px';
    hint.textContent = 'Select the radio button next to the correct answer.';
    card.appendChild(hint);

    container.appendChild(card);
  });
}

function showError(msg) {
  const el = document.getElementById('createErr');
  el.textContent = msg;
  el.classList.add('show');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearError() {
  const el = document.getElementById('createErr');
  el.classList.remove('show');
  el.textContent = '';
}

async function createTest() {
  clearError();
  const title = document.getElementById('testTitle').value.trim();
  const timeLimit = parseInt(document.getElementById('timeLimit').value, 10) || 20;

  if (!title) return showError('Please give the test a title.');
  if (questions.length === 0) return showError('Add at least one question.');

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.text.trim()) return showError(`Question ${i + 1} is missing its text.`);
    if (q.options.some((o) => !o.trim())) return showError(`Question ${i + 1} has an empty option.`);
    if (q.correctIndex === null || q.correctIndex === undefined) {
      return showError(`Question ${i + 1} needs a correct answer selected.`);
    }
  }

  const payload = {
    title,
    timeLimit,
    questions: questions.map((q) => ({
      text: q.text.trim(),
      options: q.options.map((o) => o.trim()),
      correctIndex: q.correctIndex,
    })),
  };

  const btn = document.getElementById('createTestBtn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const res = await api('/api/tests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.status === 401) return logout();
    if (!res.ok) throw new Error(data.error || 'Could not create test.');

    // reset form
    document.getElementById('testTitle').value = '';
    document.getElementById('timeLimit').value = 20;
    questions = [];
    renderQuestions();
    addQuestion();

    await loadTests();
    window.scrollTo({ top: document.body.scrollHeight * 0.4, behavior: 'smooth' });
  } catch (err) {
    showError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create test';
  }
}

async function loadTests() {
  const listEl = document.getElementById('testList');
  try {
    const res = await api('/api/tests');
    if (res.status === 401) return logout();
    const tests = await res.json();
    if (!tests.length) {
      listEl.innerHTML = '<p class="empty-state">No tests yet — create one above.</p>';
      return;
    }
    listEl.innerHTML = '';
    tests
      .slice()
      .reverse()
      .forEach((t) => {
        const row = document.createElement('div');
        row.className = 'test-row';
        row.innerHTML = `
          <div class="meta">
            <div class="title">${escapeHtml(t.title)}</div>
            <div class="sub">${t.questions.length} question${t.questions.length === 1 ? '' : 's'} · ${t.timeLimit} min</div>
          </div>
          <div class="code-chip">${t.code}</div>
          <div class="actions">
            <button type="button" class="ghost" data-action="results">Results</button>
            <button type="button" class="danger" data-action="delete">Delete</button>
          </div>
        `;
        row.querySelector('[data-action="results"]').onclick = () => viewResults(t.id, t.title);
        row.querySelector('[data-action="delete"]').onclick = () => deleteTest(t.id, t.title);
        listEl.appendChild(row);
      });
  } catch (err) {
    listEl.innerHTML = '<p class="empty-state">Could not load tests. Is the server running?</p>';
  }
}

async function deleteTest(id, title) {
  if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
  await api('/api/tests/' + id, { method: 'DELETE' });
  await loadTests();
}

let currentResultsTestId = null;
let currentResultsData = [];

async function viewResults(testId, title) {
  currentResultsTestId = testId;
  const panel = document.getElementById('resultsPanel');
  const body = document.getElementById('resultsBody');
  document.getElementById('resultsTitle').textContent = 'Results — ' + title;
  panel.style.display = 'block';
  body.innerHTML = '<p class="empty-state">Loading…</p>';
  panel.scrollIntoView({ behavior: 'smooth' });

  const res = await api('/api/results/' + testId);
  if (res.status === 401) return logout();
  const results = await res.json();
  currentResultsData = results;

  if (!Array.isArray(results) || !results.length) {
    body.innerHTML = '<p class="empty-state">No submissions yet.</p>';
    return;
  }

  const rows = results
    .slice()
    .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt))
    .map((r) => {
      const pct = Math.round((r.score / r.total) * 100);
      const badgeClass = pct >= 60 ? 'good' : 'bad';
      return `<tr>
        <td>${escapeHtml(r.studentName)}</td>
        <td>${r.score} / ${r.total}</td>
        <td><span class="badge ${badgeClass}">${pct}%</span></td>
        <td>${new Date(r.submittedAt).toLocaleString()}</td>
      </tr>`;
    })
    .join('');

  body.innerHTML = `
    <table class="results">
      <thead><tr><th>Student</th><th>Score</th><th>%</th><th>Submitted</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <button type="button" class="ghost" id="exportCsvBtn" style="margin-top:14px;">Export CSV</button>
  `;
  document.getElementById('exportCsvBtn').onclick = exportCsv;
}

function exportCsv() {
  const header = ['Student', 'Score', 'Total', 'Percent', 'Submitted At'];
  const lines = [header.join(',')];
  currentResultsData.forEach((r) => {
    const pct = Math.round((r.score / r.total) * 100);
    const row = [
      csvSafe(r.studentName),
      r.score,
      r.total,
      pct + '%',
      new Date(r.submittedAt).toISOString(),
    ];
    lines.push(row.join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'results.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function csvSafe(str) {
  const s = String(str).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- AI question generation ----

let selectedAiFiles = [];

async function checkAiStatus() {
  try {
    const res = await fetch('/api/ai-status');
    const data = await res.json();
    document.getElementById('aiPanel').style.display = data.available ? 'block' : 'none';
    document.getElementById('aiUnavailablePanel').style.display = data.available ? 'none' : 'block';
    document.getElementById('importPanel').style.display = data.available ? 'block' : 'none';
  } catch {
    // If the check itself fails, just hide both — manual test creation still works.
  }
}

// Resize/compress an image file in the browser before sending it to the server,
// to keep uploads fast and cheap. Returns { data: base64String, mediaType }.
function fileToCompressedBase64(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ data: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
      };
      img.onerror = () => reject(new Error('Could not read image: ' + file.name));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file: ' + file.name));
    reader.readAsDataURL(file);
  });
}

function showAiError(msg) {
  const el = document.getElementById('aiErr');
  el.textContent = msg;
  el.classList.add('show');
}
function clearAiError() {
  document.getElementById('aiErr').classList.remove('show');
}

document.getElementById('aiImages').addEventListener('change', (e) => {
  selectedAiFiles = Array.from(e.target.files).slice(0, 5);
  const countEl = document.getElementById('aiImageCount');
  countEl.textContent = selectedAiFiles.length
    ? `${selectedAiFiles.length} image${selectedAiFiles.length === 1 ? '' : 's'} selected`
    : 'No images selected (up to 5)';
});

document.getElementById('aiGenerateBtn').addEventListener('click', async () => {
  clearAiError();
  if (selectedAiFiles.length === 0) {
    return showAiError('Choose at least one photo of the material first.');
  }
  const numQuestions = parseInt(document.getElementById('aiNumQuestions').value, 10) || 5;
  const context = document.getElementById('aiContext').value.trim();

  const btn = document.getElementById('aiGenerateBtn');
  btn.disabled = true;
  btn.textContent = 'Reading images…';

  try {
    const images = await Promise.all(selectedAiFiles.map((f) => fileToCompressedBase64(f)));

    btn.textContent = 'Generating questions…';

    const res = await api('/api/generate-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images, numQuestions, context }),
    });
    const data = await res.json();
    if (res.status === 401) return logout();
    if (!res.ok) throw new Error(data.error || 'Generation failed.');

    // Drop the single default blank question if the user hasn't touched it yet
    if (
      questions.length === 1 &&
      !questions[0].text.trim() &&
      questions[0].options.every((o) => !o.trim())
    ) {
      questions = [];
    }

    data.questions.forEach((q) => {
      qCounter++;
      questions.push({
        id: 'q' + qCounter,
        text: q.text,
        options: q.options,
        correctIndex: q.correctIndex,
      });
    });
    renderQuestions();
    document.getElementById('aiImages').value = '';
    selectedAiFiles = [];
    document.getElementById('aiImageCount').textContent = 'No images selected (up to 5)';

    document.getElementById('questionsContainer').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showAiError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate questions';
  }
});


// ---- import an existing test file ----

let importFile = null;

function showImportError(msg) {
  const el = document.getElementById('importErr');
  el.textContent = msg;
  el.classList.add('show');
}
function clearImportError() {
  document.getElementById('importErr').classList.remove('show');
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Could not read file.'));
    r.readAsText(file);
  });
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read file.'));
    r.readAsDataURL(file);
  });
}

document.getElementById('importFile').addEventListener('change', (e) => {
  importFile = e.target.files[0] || null;
  document.getElementById('importFileName').textContent = importFile
    ? importFile.name
    : 'No file selected';
});

document.getElementById('importBtn').addEventListener('click', async () => {
  clearImportError();
  if (!importFile) return showImportError('Choose a test file first.');

  const btn = document.getElementById('importBtn');
  btn.disabled = true;
  btn.textContent = 'Reading test…';

  try {
    const name = importFile.name;
    const lower = name.toLowerCase();
    let payload;
    let guessedTitle = '';

    if (lower.endsWith('.pdf')) {
      payload = { mediaType: 'application/pdf', data: await readAsBase64(importFile) };
    } else if (importFile.type.startsWith('image/')) {
      const img = await fileToCompressedBase64(importFile);
      payload = { mediaType: img.mediaType, data: img.data };
    } else {
      const text = await readAsText(importFile);
      payload = { fileName: name, text };
      const t = text.match(/<title>([^<]+)<\/title>/i);
      if (t) guessedTitle = t[1].trim();
    }

    const res = await api('/api/extract-questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.status === 401) return logout();
    if (!res.ok) throw new Error(data.error || 'Import failed.');

    // replace the untouched blank question, if any
    if (
      questions.length === 1 &&
      !questions[0].text.trim() &&
      questions[0].options.every((o) => !o.trim())
    ) {
      questions = [];
    }

    data.questions.forEach((q) => {
      qCounter++;
      questions.push({
        id: 'q' + qCounter,
        text: q.text,
        options: q.options,
        correctIndex: q.correctIndex,
      });
    });
    renderQuestions();

    const titleInput = document.getElementById('testTitle');
    if (!titleInput.value.trim()) {
      titleInput.value = guessedTitle || name.replace(/\.[^.]+$/, '');
    }

    document.getElementById('importFile').value = '';
    importFile = null;
    document.getElementById('importFileName').textContent =
      data.questions.length + ' questions imported — review them below.';

    document.getElementById('testTitle').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showImportError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import questions';
  }
});

// ---- wire up ----
document.getElementById('addQuestionBtn').addEventListener('click', addQuestion);
document.getElementById('createTestBtn').addEventListener('click', createTest);
document.getElementById('closeResultsBtn').addEventListener('click', () => {
  document.getElementById('resultsPanel').style.display = 'none';
});

// ---- teacher sign-in ----

function showDashboard() {
  document.getElementById('loginPanel').style.display = 'none';
  document.getElementById('dashboard').style.display = 'block';
  if (questions.length === 0) addQuestion();
  loadTests();
  checkAiStatus();
}

function logout() {
  teacherCode = '';
  localStorage.removeItem('teacherCode');
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('loginPanel').style.display = 'block';
}

async function login(code) {
  const err = document.getElementById('loginErr');
  err.classList.remove('show');
  code = code.trim().toUpperCase();

  if (!code) {
    err.textContent = 'Please enter your teacher code.';
    err.classList.add('show');
    return;
  }

  try {
    const res = await fetch('/api/teacher/me', { headers: { 'x-teacher-code': code } });

    if (!res.ok) {
      err.textContent = 'That code was not recognised.';
      err.classList.add('show');
      localStorage.removeItem('teacherCode');
      return;
    }
  } catch {
    err.textContent = 'Could not reach the server.';
    err.classList.add('show');
    return;
  }

  teacherCode = code;
  localStorage.setItem('teacherCode', code);
  showDashboard();
}

document.getElementById('loginBtn').addEventListener('click', () =>
  login(document.getElementById('teacherCodeInput').value)
);
document.getElementById('teacherCodeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login(e.target.value);
});
document.getElementById('logoutBtn').addEventListener('click', logout);

// auto sign-in if a code was saved earlier in this browser tab
if (teacherCode) login(teacherCode);
