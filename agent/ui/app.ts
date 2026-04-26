const MAX_QUESTION_LENGTH = 1000;

const questionInput = document.getElementById('question') as HTMLTextAreaElement;
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const loading = document.getElementById('loading') as HTMLDivElement;
const errorEl = document.getElementById('error') as HTMLDivElement;
const answerSection = document.getElementById('answerSection') as HTMLDivElement;
const answerText = document.getElementById('answerText') as HTMLDivElement;

interface AskResponse {
  answer: string;
}

interface ErrorResponse {
  error?: string;
}

const show = (el: Element) => el.classList.add('show');
const hide = (el: Element) => el.classList.remove('show');

function setLoading(active: boolean): void {
  if (active) show(loading);
  else hide(loading);
  submitBtn.disabled = active;
  questionInput.disabled = active;
}

submitBtn.addEventListener('click', async () => {
  const question = questionInput.value.trim();
  if (!question) {
    showError('Please enter a question.');
    return;
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    showError(`Question is too long (max ${MAX_QUESTION_LENGTH} characters).`);
    return;
  }
  await askQuestion(question);
});

clearBtn.addEventListener('click', () => {
  questionInput.value = '';
  hide(errorEl);
  hide(answerSection);
  questionInput.focus();
});

questionInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && e.ctrlKey) submitBtn.click();
});

async function askQuestion(question: string): Promise<void> {
  hide(errorEl);
  hide(answerSection);
  setLoading(true);
  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error((data as ErrorResponse).error ?? 'Failed to get an answer');
    }

    displayAnswer((data as AskResponse).answer);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'An unexpected error occurred.');
  } finally {
    setLoading(false);
  }
}

function displayAnswer(answer: string): void {
  answerText.textContent = answer;
  show(answerSection);
}

function showError(message: string): void {
  errorEl.textContent = message;
  show(errorEl);
}

questionInput.focus();
