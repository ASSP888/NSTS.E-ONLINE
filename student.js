const MAX_VIOLATIONS = 3;

let currentTest = null;
let student = { name: '', fatherName: '' };
let answers = {}; // questionId -> ORIGINAL option index (stays correct even when options are shuffled)
let timerInterval = null;
let endTime = 0;
let lastBellSecond = null;
let submitted = false;
let quizActive = false;
let dialogOpen = false;
let violations = 0;
let lastViolationAt = 0;
let audioCtx = null;

const $ = (id) => document.getElementById(id);

function showJoinError(msg) {
  const el = $('joinErr');
  el.textContent = msg;
  el.classList.add('show');
}
function clearJoinError() {
  $('joinErr').classList.remove('show');
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2500);
}

// ---------- bell (Web Audio, no files needed) ----------
function initAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {}
}

function ringBell(long) {
  if (navigator.vibrate) navigator.vibrate(long ? [400, 100, 400] : 150);
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const dur = long ? 2.2 : 0.9;
    const master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.6, now + 0.01);
    master.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    master.connect(audioCtx.destination);
    [[880, 1], [1760, 0.5], [2637, 0.25], [3520, 0.12]].forEach(([freq, vol]) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.value = vol;
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + dur);
    });
  } catch {}
}

// ---------- join ----------
function enterFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if (fn) {
    try {
      const p = fn.call(el);
      if (p && p.catch) p.catch(() => {});
    } catch {}
  }
}

async function joinTest() {
  clearJoinError();
  const name = $('studentName').value.trim();
  const fatherName = $('fatherName').value.trim();
  const code = $('testCode').value.trim().toUpperCase();

  if (!name) return showJoinError('Enter your name.');
  if (!fatherName) return showJoinError("Enter your father's name.");
  if (!code) return showJoinError('Enter the test code your teacher gave you.');

  initAudio(); // must happen inside the click so the browser allows sound later

  const btn = $('joinBtn');
  btn.disabled = true;
  btn.textContent = 'Loading…';

  try {
    const res = await fetch('/api/tests/code/' + encodeURIComponent(code));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not find that test.');

    currentTest = data;
    student = { name, fatherName };
    answers = {};
    submitted = false;
    violations = 0;
    endTime = Date.now() + currentTest.timeLimit * 60 * 1000;

    enterFullscreen();
    startQuiz();
  } catch (err) {
    showJoinError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start test';
  }
}

// ---------- quiz ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Consecutive questions sharing the same paragraph are kept together as one group.
function buildGroups(questions) {
  const groups = [];
  questions.forEach((q) => {
    const p = (q.passage || '').trim();
    const last = groups[groups.length - 1];
    if (p && last && last.passage === p) last.questions.push(q);
    else groups.push({ passage: p, questions: [q] });
  });
  return groups;
}

function startQuiz() {
  $('joinScreen').style.display = 'none';
  $('quizScreen').style.display = 'block';
  $('quizTitle').textContent = currentTest.title;
  $('homeLink').style.display = 'none';
  document.body.classList.add('test-active');
  quizActive = true;
  renderQuiz();
  updateProgress();
  window.scrollTo(0, 0);

  lastBellSecond = null;
  const hdr = $('headerTimer');
  hdr.classList.add('show');
  timerInterval = setInterval(tick, 250);
  tick();
}

function tick() {
  const left = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  updateTimerDisplay(left);
  if (left > 0 && left <= 5 && left !== lastBellSecond) {
    lastBellSecond = left;
    ringBell(false);
  }
  if (left <= 0) {
    clearInterval(timerInterval);
    ringBell(true);
    submitQuiz(true, 'time');
  }
}

function updateTimerDisplay(left) {
  const el = $('headerTimer');
  const m = Math.floor(left / 60);
  const s = left % 60;
  el.textContent = `⏱ ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('low', left <= 60);
  el.classList.toggle('alarm', left <= 5);
}

function renderQuiz() {
  const area = $('questionsArea');
  area.innerHTML = '';

  let groups = buildGroups(currentTest.questions);
  if (currentTest.shuffleQuestions) groups = shuffle(groups);

  let number = 0;
  groups.forEach((g) => {
    if (g.passage) {
      const box = document.createElement('div');
      box.className = 'passage-box';
      const label = document.createElement('div');
      label.className = 'passage-label';
      label.textContent = 'Read the paragraph and answer the following questions';
      const text = document.createElement('div');
      text.className = 'passage-text';
      text.textContent = g.passage;
      box.appendChild(label);
      box.appendChild(text);
      area.appendChild(box);
    }

    g.questions.forEach((q) => {
      number++;
      const block = document.createElement('div');
      block.className = 'quiz-q';
      block.dataset.qid = q.id;
      const title = document.createElement('div');
      title.className = 'q-text';
      title.textContent = `${number}. ${q.text}`;
      block.appendChild(title);

      let opts = q.options.map((text, orig) => ({ text, orig }));
      if (currentTest.shuffleOptions) opts = shuffle(opts);

      opts.forEach((o) => {
        const row = document.createElement('label');
        row.className = 'quiz-opt';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'answer-' + q.id;
        radio.onchange = () => selectAnswer(q.id, o.orig, row, block);

        const span = document.createElement('span');
        span.textContent = o.text;

        row.appendChild(radio);
        row.appendChild(span);
        block.appendChild(row);
      });

      area.appendChild(block);
    });
  });
}

function selectAnswer(qid, origIndex, row, block) {
  answers[qid] = origIndex;
  block.querySelectorAll('.quiz-opt').forEach((r) => r.classList.toggle('answered', r === row));
  updateProgress();
}

function updateProgress() {
  const n = Object.keys(answers).length;
  $('quizProgress').textContent = `${n} of ${currentTest.questions.length} answered`;
}

async function submitQuiz(auto, reason) {
  if (submitted) return;
  submitted = true;
  clearInterval(timerInterval);

  if (!auto) {
    const unanswered = currentTest.questions.length - Object.keys(answers).length;
    if (unanswered > 0) {
      dialogOpen = true;
      const proceed = confirm(`You have ${unanswered} unanswered question(s). Submit anyway?`);
      dialogOpen = false;
      if (!proceed) {
        submitted = false;
        timerInterval = setInterval(tick, 250);
        return;
      }
    }
  }

  const submitBtn = $('submitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';

  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testId: currentTest.id,
        studentName: student.name,
        fatherName: student.fatherName,
        answers,
        violations,
        submitReason: reason || 'manual',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Submission failed.');

    finishQuiz();
    $('quizScreen').style.display = 'none';
    $('scoreScreen').style.display = 'block';
    $('scoreDisplay').innerHTML = `${data.score} <span>/ ${data.total}</span>`;
    if (reason === 'violations') {
      $('scoreHeading').textContent = 'Test submitted automatically';
      $('scoreNote').textContent = 'You left the test screen too many times, so the test was submitted. Your teacher can see this.';
    } else if (reason === 'time') {
      $('scoreHeading').textContent = "Time's up — test submitted";
    }
  } catch (err) {
    if (/already been submitted/i.test(err.message)) {
      finishQuiz();
      $('quizScreen').style.display = 'none';
      $('scoreScreen').style.display = 'block';
      $('scoreHeading').textContent = 'Already submitted';
      $('scoreDisplay').textContent = '—';
      $('scoreNote').textContent = err.message;
      return;
    }
    alert('Could not submit: ' + err.message + '\nCheck your connection and try again.');
    submitted = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit test';
    if (!auto) timerInterval = setInterval(tick, 250);
    else if (Date.now() < endTime) timerInterval = setInterval(tick, 250);
  }
}

// stop protections and restore normal page once the test is over
function finishQuiz() {
  quizActive = false;
  document.body.classList.remove('test-active');
  $('headerTimer').classList.remove('show', 'alarm', 'low');
  $('homeLink').style.display = '';
  $('warnOverlay').classList.remove('show');
  try {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
  } catch {}
}

// ---------- anti-cheating ----------
function showWarning(title, text) {
  $('warnTitle').textContent = title;
  $('warnText').textContent = text;
  $('warnOverlay').classList.add('show');
}

function registerViolation(what) {
  if (!quizActive || submitted || dialogOpen) return;
  const now = Date.now();
  if (now - lastViolationAt < 1500) return; // blur + visibilitychange fire together
  lastViolationAt = now;
  violations++;

  if (violations >= MAX_VIOLATIONS) {
    showWarning('Test ended', `You ${what} ${violations} times. Your test is being submitted.`);
    submitQuiz(true, 'violations');
    return;
  }
  showWarning(
    `Warning ${violations} of ${MAX_VIOLATIONS}`,
    `You ${what}. This has been recorded for your teacher. At ${MAX_VIOLATIONS} warnings your test will be submitted automatically.`
  );
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) registerViolation('switched to another tab or app');
});
window.addEventListener('blur', () => registerViolation('left the test window'));
document.addEventListener('fullscreenchange', () => {
  if (quizActive && !submitted && !document.fullscreenElement) registerViolation('exited full screen');
});

$('warnContinueBtn').addEventListener('click', () => {
  $('warnOverlay').classList.remove('show');
  if (quizActive && !document.fullscreenElement) enterFullscreen();
  window.focus();
});

['copy', 'cut', 'paste', 'contextmenu', 'selectstart', 'dragstart'].forEach((ev) => {
  document.addEventListener(ev, (e) => {
    if (!quizActive) return;
    e.preventDefault();
    if (ev === 'copy' || ev === 'cut' || ev === 'paste') toast('Copy and paste are disabled during the test.');
  });
});

document.addEventListener('keydown', (e) => {
  if (!quizActive) return;
  const k = (e.key || '').toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  const blocked =
    (mod && ['c', 'x', 'v', 'a', 'p', 's', 'u', 'f'].includes(k)) ||
    (mod && e.shiftKey && ['i', 'j', 'c', 'k'].includes(k)) ||
    (e.metaKey && e.altKey && ['i', 'j', 'c', 'u'].includes(k)) ||
    k === 'f12';
  if (blocked) {
    e.preventDefault();
    toast('That shortcut is disabled during the test.');
  }
});

document.addEventListener('keyup', (e) => {
  if (quizActive && e.key === 'PrintScreen') {
    try { navigator.clipboard.writeText(''); } catch {}
    toast('Screenshots are not allowed during the test.');
  }
});

// ---------- wiring ----------
$('joinBtn').addEventListener('click', joinTest);
$('studentName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('fatherName').focus(); });
$('fatherName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('testCode').focus(); });
$('testCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinTest(); });
$('submitBtn').addEventListener('click', () => submitQuiz(false, 'manual'));

window.addEventListener('beforeunload', (e) => {
  if (currentTest && !submitted) {
    e.preventDefault();
    e.returnValue = '';
  }
});
