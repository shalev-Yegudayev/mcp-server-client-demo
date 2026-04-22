const questionInput = document.getElementById('question') as HTMLTextAreaElement;
const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement;
const loading = document.getElementById('loading') as HTMLDivElement;
const error = document.getElementById('error') as HTMLDivElement;
const answerSection = document.getElementById('answerSection') as HTMLDivElement;
const answerText = document.getElementById('answerText') as HTMLDivElement;

submitBtn.addEventListener('click', async () => {
  const question = questionInput.value.trim();
  if (!question) {
    showError('Please enter a question.');
    return;
  }
  if (question.length > 1000) {
    showError('Question is too long (max 1000 characters).');
    return;
  }
  await askQuestion(question);
});

clearBtn.addEventListener('click', () => {
  questionInput.value = '';
  error.classList.remove('show');
  answerSection.classList.remove('show');
  questionInput.focus();
});

questionInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' && e.ctrlKey) submitBtn.click();
});

async function askQuestion(question: string): Promise<void> {
  error.classList.remove('show');
  answerSection.classList.remove('show');
  loading.classList.add('show');
  submitBtn.disabled = true;
  questionInput.disabled = true;
  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error((data as { error?: string }).error || 'Failed to get an answer');
    }

    const data = await response.json();
    displayAnswer((data as { answer: string }).answer);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'An unexpected error occurred.');
  } finally {
    loading.classList.remove('show');
    submitBtn.disabled = false;
    questionInput.disabled = false;
  }
}

function displayAnswer(answer: string): void {
  answerText.textContent = answer;
  answerSection.classList.add('show');
}

function showError(message: string): void {
  error.textContent = message;
  error.classList.add('show');
}

questionInput.focus();
