import { cpSync } from 'fs';
cpSync('agent/ui', 'agent/dist/ui', { recursive: true });
