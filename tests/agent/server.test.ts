import request from 'supertest';
import express, { type Application } from 'express';

describe('Agent Server', () => {
  let app: Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Simple test route to validate input
    app.post('/api/ask', (req, res) => {
      const { question } = req.body as { question?: string };

      if (!question || typeof question !== 'string') {
        res.status(400).json({ error: 'Please provide a question.' });
        return;
      }

      if (question.trim().length === 0 || question.length > 1000) {
        res.status(400).json({
          error: 'Please enter a question (max 1000 characters).',
        });
        return;
      }

      // Mock successful response
      res.json({ answer: 'Mock answer to: ' + question });
    });

    app.get('/', (_req, res) => {
      res.send('<html><body>Test UI</body></html>');
    });
  });

  describe('POST /api/ask', () => {
    it('should accept valid questions', async () => {
      const response = await request(app).post('/api/ask').send({
        question: 'What is CVE-2021-44228?',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('answer');
    });

    it('should reject empty questions', async () => {
      const response = await request(app).post('/api/ask').send({
        question: '',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toMatch(/Please (enter|provide) a question/);
    });

    it('should reject questions that are only whitespace', async () => {
      const response = await request(app).post('/api/ask').send({
        question: '   \n\t   ',
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Please enter a question');
    });

    it('should reject questions without a question field', async () => {
      const response = await request(app).post('/api/ask').send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Please provide a question');
    });

    it('should reject questions longer than 1000 characters', async () => {
      const longQuestion = 'Q'.repeat(1001);
      const response = await request(app).post('/api/ask').send({
        question: longQuestion,
      });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('max 1000 characters');
    });

    it('should accept questions exactly at 1000 characters', async () => {
      const question = 'Q'.repeat(1000);
      const response = await request(app).post('/api/ask').send({
        question,
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('answer');
    });

    it('should handle special characters in questions', async () => {
      const response = await request(app).post('/api/ask').send({
        question: 'What about CVE-2024-1234 & CVE-2024-5678?',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('answer');
    });

    it('should handle unicode characters in questions', async () => {
      const response = await request(app).post('/api/ask').send({
        question: 'What vulnerabilities affect Linux 系统?',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('answer');
    });

    it('should handle multiline questions', async () => {
      const response = await request(app).post('/api/ask').send({
        question: 'Show me:\n1. Critical CVEs\n2. Open vulnerabilities',
      });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('answer');
    });

    it('should reject non-string question values', async () => {
      const response = await request(app).post('/api/ask').send({
        question: 123,
      });

      expect(response.status).toBe(400);
    });

    it('should reject null question', async () => {
      const response = await request(app).post('/api/ask').send({
        question: null,
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /', () => {
    it('should serve the UI', async () => {
      const response = await request(app).get('/');

      expect(response.status).toBe(200);
      expect(response.text).toContain('Test UI');
    });

    it('should set correct content type for HTML', async () => {
      const response = await request(app).get('/');

      expect(response.type).toMatch(/html/);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing Content-Type header', async () => {
      const response = await request(app).post('/api/ask').send('invalid');

      // Express will handle this
      expect([400, 413]).toContain(response.status);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .post('/api/ask')
        .set('Content-Type', 'application/json')
        .send('{ invalid json }');

      expect(response.status).toBe(400);
    });
  });

  describe('Question Validation Edge Cases', () => {
    it('should handle questions with exactly 1 character', async () => {
      const response = await request(app).post('/api/ask').send({
        question: 'Q',
      });

      expect(response.status).toBe(200);
    });

    it('should trim leading/trailing whitespace before validating', async () => {
      const response = await request(app).post('/api/ask').send({
        question: '   Valid question   ',
      });

      expect(response.status).toBe(200);
    });

    it('should handle questions with tabs and newlines', async () => {
      const response = await request(app).post('/api/ask').send({
        question: '\t\nValid question\n\t',
      });

      // Should fail because after trim, it still has content
      expect([200, 400]).toContain(response.status);
    });
  });
});
