let currentTest = null;
let studentName = '';
let answers = {}; // questionId -> optionIndex
let timerInterval = null;
let secondsLeft = 0;
let submitted = false;

function showJoinError(msg) {
  const el = document.getElementById('joinErr');
  el.textContent = msg;
  el.classList.add('show');
}
function clearJoinError() {
  document.getElementById('joinErr').classList.remove('show');
}

async function joinTest() {
  clearJoinError();
  const codeInput = document.getElementById('testCode');
  const nameInput = document.getElementById('studentName');
  const code = codeInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();

  if (!code) return showJoinError('Enter the test code your teacher gave you.');
  if (!name) return showJoinError('Enter your name.');

  const btn = document.getElementById('joinBtn');
  btn.disabled = true;
  btn.textContent = 'Loading…';

  try {
    const res = await fetch('/api/tests/code/' + encodeURIComponent(code));
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not find that test.');

    currentTest = data;
    studentName = name;
    answers = {};
    secondsLeft = currentTest.timeLimit * 60;
    submitted = false;

    startQuiz();
  } catch (err) {
    showJoinError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start test';
  }
}

function startQuiz() {
  document.getElementById('joinScreen').style.display = 'none';
  document.getElementById('quizScreen').style.display = 'block';
  document.getElementById('quizTitle').textContent = currentTest.title;
  renderQuiz();
  updateProgress();

  timerInterval = setInterval(() => {
    secondsLeft--;
    updateTimerDisplay();
    if (secondsLeft <= 0) {
      clearInterval(timerInterval);
      submitQuiz(true);
    }
  }, 1000);
  updateTimerDisplay();
}

function updateTimerDisplay() {
  const el = document.getElementById('timerDisplay');
  const m = Math.max(0, Math.floor(secondsLeft / 60));
  const s = Math.max(0, secondsLeft % 60);
  el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  el.classList.toggle('low', secondsLeft <= 60);
}

function renderQuiz() {
  const area = document.getElementById('questionsArea');
  area.innerHTML = '';
  currentTest.questions.forEach((q, qi) => {
    const block = document.createElement('div');
    block.className = 'quiz-q';
    block.innerHTML = `<div class="q-text">${qi + 1}. ${escapeHtml(q.text)}</div>`;

    q.options.forEach((opt, oi) => {
      const optRow = document.createElement('label');
      optRow.className = 'quiz-opt';
      optRow.id = `opt-${q.id}-${oi}`;

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'answer-' + q.id;
      radio.value = oi;
      radio.onchange = () => selectAnswer(q.id, oi);

      const label = document.createElement('span');
      label.textContent = opt;

      optRow.appendChild(radio);
      optRow.appendChild(label);
      block.appendChild(optRow);
    });

    area.appendChild(block);
  });
}

function selectAnswer(qid, oi) {
  answers[qid] = oi;
  currentTest.questions
    .find((q) => q.id === qid)
    .options.forEach((_, i) => {
      document.getElementById(`opt-${qid}-${i}`).classList.toggle('answered', i === oi);
    });
  updateProgress();
}

function updateProgress() {
  const answeredCount = Object.keys(answers).length;
  document.getElementById('quizProgress').textContent =
    `${answeredCount} of ${currentTest.questions.length} answered`;
}

async function submitQuiz(auto) {
  if (submitted) return;
  submitted = true;
  clearInterval(timerInterval);

  if (!auto) {
    const unanswered = currentTest.questions.length - Object.keys(answers).length;
    if (unanswered > 0) {
      const proceed = confirm(`You have ${unanswered} unanswered question(s). Submit anyway?`);
      if (!proceed) {
        submitted = false;
        return;
      }
    }
  }

  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';

  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testId: currentTest.id, studentName, answers }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Submission failed.');

    document.getElementById('quizScreen').style.display = 'none';
    document.getElementById('scoreScreen').style.display = 'block';
    document.getElementById('scoreDisplay').innerHTML =
      `${data.score} <span>/ ${data.total}</span>`;
  } catch (err) {
    alert('Could not submit: ' + err.message + '\nCheck your connection and try again.');
    submitted = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit test';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('joinBtn').addEventListener('click', joinTest);
document.getElementById('testCode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('studentName').focus();
});
document.getElementById('studentName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinTest();
});
document.getElementById('submitBtn').addEventListener('click', () => submitQuiz(false));

window.addEventListener('beforeunload', (e) => {
  if (currentTest && !submitted) {
    e.preventDefault();
    e.returnValue = '';
  }
});
