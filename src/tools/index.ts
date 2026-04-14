import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Store } from '../store.js';
import { registerGetVulnerabilityByCve } from './getVulnerabilityByCve.js';
import { registerSearchVulnerabilities } from './searchVulnerabilities.js';
import { registerListVendors } from './listVendors.js';
import { registerGetVendorVulnerabilities } from './getVendorVulnerabilities.js';
import { registerVulnerabilityStats } from './vulnerabilityStats.js';
import { registerTopCriticalOpen } from './topCriticalOpen.js';

export function registerTools(server: McpServer, store: Store): void {
  registerGetVulnerabilityByCve(server, store);
  registerSearchVulnerabilities(server, store);
  registerListVendors(server, store);
  registerGetVendorVulnerabilities(server, store);
  registerVulnerabilityStats(server, store);
  registerTopCriticalOpen(server, store);
}
