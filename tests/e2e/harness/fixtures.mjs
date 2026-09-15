/**
 * E2E Test Fixtures — Nice Assistant v1.2.0
 * Comprehensive realistic test data for tabular, markdown, structured JSON,
 * contacts, battery states, and calendar events.
 */

// ===== 1. TABULAR FIXTURES (CSV / TSV / XLSX) =====

export const SAMPLE_USERS_CSV = `id,name,role,department,location
1,"Alice Smith",Admin,Engineering,Seattle
2,"Bob Jones",Manager,Marketing,"New York, NY"
3,"Charlie Brown",Developer,Engineering,"Austin, TX"
4,"Diana Prince",Director,Operations,Chicago
5,"Evan Wright",Specialist,Support,"San Francisco, CA"`;

export const SAMPLE_STAFF_CSV = `Name,Dept,Salary
Alice Smith,Engineering,125000
Bob Jones,Marketing,95000
Charlie Brown,Engineering,110000
Diana Prince,Operations,140000
Evan Wright,Support,75000`;

export const SAMPLE_EXPENSES_CSV = `Category,Q1,Q2,Q3,Total
Operating Expenses,$38000,$41000,$42500,$121500
Marketing & Sales,$15000,$18000,$19500,$52500
R&D Infrastructure,$62000,$65000,$68000,$195000
General Administrative,$12000,$12500,$13000,$37500`;

export const SAMPLE_METRICS_TSV = `metric\tvalue\tunit\ttimestamp
cpu_usage\t42.5\tpercent\t2026-09-12T10:00:00Z
memory_used\t3120\tMB\t2026-09-12T10:00:00Z
disk_free\t48.2\tGB\t2026-09-12T10:00:00Z
requests_per_sec\t1250\trps\t2026-09-12T10:00:00Z`;

export const SAMPLE_MULTILINGUAL_TSV = `製品名\t数量\t単価\t状態
ノートパソコン\t15\t120000\t在庫あり
ワイヤレスマウス\t50\t3500\t在庫あり
メカニカルキーボード\t25\t14000\t入荷待ち
モニター 27インチ\t10\t45000\t在庫僅少`;

export const SAMPLE_EMPTY_CSV = ``;
export const SAMPLE_WHITESPACE_CSV = `   \r\n\t\t\r\n   \n   `;
export const SAMPLE_HEADER_ONLY_CSV = `id,first_name,last_name,department,salary\n`;

export const SAMPLE_BROKEN_QUOTES_CSV = `id,desc,value
1,"unclosed quote text,100
2,normal,200`;

export const SAMPLE_RAGGED_CSV = `A,B,C,D
1,2
1,2,3,4,5,6`;

export const SAMPLE_DUPLICATE_HEADERS_CSV = `name,,name,age,,notes
Alice,Engineering,Smith,30,Active,Lead architect`;

export const SAMPLE_GIANT_CELL_CSV = `id,title,notes
101,Architecture,"${'A'.repeat(50000)}"`;

// Generate 500 column headers
export const SAMPLE_WIDE_CSV = (() => {
  const headers = Array.from({ length: 500 }, (_, i) => `col_${i + 1}`).join(',');
  const row1 = Array.from({ length: 500 }, (_, i) => `val_${i + 1}`).join(',');
  const row2 = Array.from({ length: 500 }, (_, i) => `data_${i + 1}`).join(',');
  return `${headers}\n${row1}\n${row2}`;
})();

// Minimal valid XLSX representation (ZIP with XML sheet structures or mock workbook buffer)
export const SAMPLE_MINIMAL_XLSX_DATA = {
  fileName: 'Q3_Financial_Summary.xlsx',
  sheets: [
    {
      name: 'Summary',
      headers: ['Category', 'Q1_Actual', 'Q2_Actual', 'Q3_Actual', 'Notes'],
      rows: [
        ['Operating Expenses', '$1,050,000', '$1,120,000', '$1,245,000', 'Cloud expansion'],
        ['Marketing & Growth', '$320,000', '$350,000', '$390,000', 'Product launch'],
        ['R&D Payroll', '$2,100,000', '$2,250,000', '$2,400,000', 'Edge AI engineering'],
        ['General Administrative', '$180,000', '$185,000', '$190,000', 'Facilities'],
      ],
    },
    {
      name: 'Headcount',
      headers: ['Department', 'Count', 'Openings'],
      rows: [
        ['Engineering', '45', '8'],
        ['Product', '12', '2'],
        ['Sales', '18', '5'],
      ],
    },
  ],
};

export const SAMPLE_CANDIDATES_XLSX_DATA = {
  fileName: 'candidates_pipeline_q3.xlsx',
  sheets: [
    {
      name: 'Candidates',
      headers: ['Name', 'Role', 'Rating', 'ExpectedComp', 'NoticePeriod', 'Location'],
      rows: [
        ['Elena Rostova', 'Senior Android Engineer', '4.8', '$165k', '30 days', 'Berlin'],
        ['Kenji Tanaka', 'Edge LLM Specialist', '4.9', '$180k', '60 days', 'Tokyo'],
        ['Sarah Connor', 'QA Lead', '4.6', '$135k', '14 days', 'Austin'],
        ['Alex Miller', 'Junior Frontend Dev', '3.9', '$85k', 'Immediate', 'London'],
      ],
    },
  ],
};

export const SAMPLE_INVENTORY_XLSX_DATA = {
  fileName: 'stock.xlsx',
  sheets: [
    {
      name: 'Inventory',
      headers: ['SKU', 'ItemName', 'Quantity', 'RestockDate', 'Supplier'],
      rows: [
        ['SKU-901', 'High Capacity Battery Pack', '140', '2026-10-01', 'ElectroCorp'],
        ['SKU-5542', 'Industrial Bearings', '45', '2026-09-25', 'Apex Precision'],
      ],
    },
  ],
};

// ===== 2. MARKDOWN FIXTURES =====

export const SAMPLE_README_MD = `# Nice Assistant

A privacy-first, 100% offline edge AI assistant for Android and Web.

## Installation

Run the following command in your terminal:

\`\`\`bash
npm install
npm run build
\`\`\`

## Architecture

Nice Assistant operates with a multi-layered local execution stack:
- **Filesys Engine**: On-demand IndexedDB metadata cache and streaming reader.
- **Search Engine**: Zero-copy BM25-lite retrieval with paragraph splitting.
- **Offline Brain**: Local neural models running via Web Workers.

### Database

The database uses IndexedDB with stores for \`file_index\` and \`dir_handles\`.

| Store Name | Key Path | Indices |
|---|---|---|
| file_index | id | name, type, ext |
| dir_handles | id | (none) |

## Features

1. Instant full-text search across local files.
2. Device automation without remote server dependence.
3. Completely confidential and zero-network operational security.`;

export const SAMPLE_PROJECT_BRIEF_MD = `# Project Alpha Kickoff

## Objectives
Launch the v1.2.0 upgrade with native Android device bridge support.

## Schedule
The Project Kickoff meeting is scheduled for tomorrow at 10 AM in Conference Room B.

## Key Deliverables
- Device bridge plugin for Capacitor
- Tabular search for CSV and XLSX
- Multi-turn conversation buffer`;

export const SAMPLE_TROUBLESHOOTING_MD = `# Troubleshooting Guide

## Database Errors

### Error code 404: Database host unreachable
When encountering this error:
1. Verify the local cluster socket is active.
2. Check firewall rules for port 5432.
3. Ensure the postgres process is running locally.

### Error 500: Out of Memory
Reduce worker batch size and enforce context clamping.`;

export const SAMPLE_MSA_2025_MD = `# Master Services Agreement 2025

### Section 11: Limitation of Liability
The aggregate liability of either party under this agreement shall be capped at 12 months fees paid.`;

export const SAMPLE_MSA_2026_DRAFT_MD = `# Master Services Agreement 2026 (Draft)

### Section 11: Limitation of Liability
The aggregate liability of either party under this agreement shall be capped at 2x annual fees.`;

export const SAMPLE_DEEP_MARKDOWN = `# H1 Header
## H2 Subheader
### H3 Section
#### H4 Detail
##### H5 Subdetail
###### H6 Leaf
Leaf text content for deep hierarchy testing.`;

// ===== 3. STRUCTURED JSON & CODE FIXTURES =====

export const SAMPLE_SERVER_CONFIG_JSON = JSON.stringify({
  server: {
    host: 'localhost',
    port: 8080,
    ssl: {
      enabled: true,
      cert: '/etc/ssl/cert.pem',
      key: '/etc/ssl/key.pem',
    },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST'],
    },
  },
  database: {
    client: 'sqlite3',
    connection: {
      filename: './nice.sqlite',
    },
  },
  logging: {
    level: 'debug',
    transports: ['console', 'file'],
  },
}, null, 2);

export const SAMPLE_CLUSTER_DEPLOYMENT_JSON = JSON.stringify({
  deploymentId: 'dep-9042',
  environment: 'production',
  infrastructure: {
    databases: {
      primary: {
        endpoint: 'pg-cluster-prod-01.internal',
        port: 5432,
        poolSize: 200,
      },
      replica: {
        endpoint: 'pg-cluster-prod-01-ro.internal',
        port: 5432,
      },
    },
    services: {
      auth: { port: 4001, replicas: 3 },
      search: { port: 4002, replicas: 5 },
    },
  },
}, null, 2);

export const SAMPLE_SOURCE_CODE_JS = `// Nice Assistant Utility
import { showToast } from './actions.js';

export function calculateTax(amount, rate = 0.18) {
  if (typeof amount !== 'number' || amount < 0) {
    throw new Error('Invalid amount');
  }
  const tax = amount * rate;
  return Number(tax.toFixed(2));
}

const 🚀 = "planet 🪐";
// Test helper function
function runDiagnostics() {
  console.log("System healthy:", 🚀);
}
`;

// ===== 4. CONTACTS FIXTURES =====

export const SAMPLE_CONTACTS = [
  {
    id: 'c1',
    name: 'Alice Smith',
    phone: '+1-555-0101',
    type: 'Mobile',
    email: 'alice@company.com',
  },
  {
    id: 'c2',
    name: 'Bob Jones',
    phone: '+1-555-0102',
    type: 'Work',
    email: 'bob@marketing.com',
  },
  {
    id: 'c3',
    name: 'Marcus Vance',
    phone: '+1-555-0144',
    type: 'Mobile',
    email: 'marcus@nice.local',
  },
  {
    id: 'c4',
    name: 'Elena Rostova',
    phone: '+1-555-0182',
    type: 'Mobile',
    email: 'elena@android.dev',
  },
  {
    id: 'c5',
    name: 'David Johnson',
    phone: '+1-555-0199',
    type: 'Mobile',
    email: 'david@logistics.com',
  },
  {
    id: 'c6',
    name: 'Jane Doe',
    phone: '+1-555-0131',
    type: 'Mobile',
    phones: [
      { number: '+1-555-0131', type: 'Mobile' },
      { number: '+1-555-0132', type: 'Home' },
      { number: '+1-555-0133', type: 'Work' },
      { number: '+1-555-0134', type: 'Other' },
    ],
    email: 'jane@enterprise.org',
  },
  {
    id: 'c7',
    name: 'Jennifer Brooks',
    phone: '+1-555-0177',
    type: 'Mobile',
    email: 'jennifer@realty.com',
  },
  {
    id: 'c8',
    name: 'Dr. Robert',
    phone: '+1-555-0190',
    type: 'Office',
    email: 'robert@clinic.org',
  },
  {
    id: 'c9',
    name: '佐藤 健',
    phone: '090-1234-5678',
    type: 'Mobile',
    email: 'sato@tokyo.jp',
  },
];
