// ===================================================================
// ADVERSARIAL STRESS HARNESS — CSV/TSV & XLSX INGESTION
// Milestone 1 (M1) Challenger 1 Verification
// ===================================================================

import assert from 'node:assert';
import zlib from 'node:zlib';
import {
    parseCsv,
    detectDelimiter,
    chunkTabularData,
    extractXlsxText,
    colLettersToIndex,
    parseWorksheetRows,
    parseSharedStrings,
    parseWorkbookSheets,
    readZipEntries,
    extractZipTextFile,
    splitIntoParagraphs,
} from '../src/search-engine.js';

let passedAssertions = 0;
let failedAssertions = 0;
const findings = [];

function stressAssert(condition, message, details = {}) {
    if (condition) {
        passedAssertions++;
    } else {
        failedAssertions++;
        findings.push({ message, details });
        console.error(`  ❌ FAIL: ${message}`);
        if (Object.keys(details).length > 0) {
            console.error('     Details:', JSON.stringify(details, null, 2));
        }
    }
}

// Helper: generate synthetic PKZIP buffer in memory
function buildZipBuffer(files) {
    const parts = [];
    const cdHeaders = [];
    let currentOffset = 0;

    for (const file of files) {
        const nameBytes = Buffer.from(file.name, 'utf-8');
        const contentBytes = typeof file.content === 'string'
            ? Buffer.from(file.content, 'utf-8')
            : Buffer.from(file.content);

        const method = file.method !== undefined ? file.method : 8; // 8 = deflate, 0 = store
        let compressed;
        if (method === 8) {
            compressed = zlib.deflateRawSync(contentBytes);
        } else {
            compressed = contentBytes;
        }

        const localHeader = Buffer.alloc(30 + nameBytes.length);
        localHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0, 6);
        localHeader.writeUInt16LE(method, 8);
        localHeader.writeUInt16LE(0, 10);
        localHeader.writeUInt16LE(0, 12);
        localHeader.writeUInt32LE(0, 14); // crc32 dummy
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(contentBytes.length, 22);
        localHeader.writeUInt16LE(nameBytes.length, 26);
        localHeader.writeUInt16LE(0, 28);
        nameBytes.copy(localHeader, 30);

        const cdHeader = Buffer.alloc(46 + nameBytes.length);
        cdHeader.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
        cdHeader.writeUInt16LE(20, 4);
        cdHeader.writeUInt16LE(20, 6);
        cdHeader.writeUInt16LE(0, 8);
        cdHeader.writeUInt16LE(method, 10);
        cdHeader.writeUInt16LE(0, 12);
        cdHeader.writeUInt16LE(0, 14);
        cdHeader.writeUInt32LE(0, 16);
        cdHeader.writeUInt32LE(compressed.length, 20);
        cdHeader.writeUInt32LE(contentBytes.length, 24);
        cdHeader.writeUInt16LE(nameBytes.length, 28);
        cdHeader.writeUInt16LE(0, 30);
        cdHeader.writeUInt16LE(0, 32);
        cdHeader.writeUInt16LE(0, 34);
        cdHeader.writeUInt16LE(0, 36);
        cdHeader.writeUInt32LE(0, 38);
        cdHeader.writeUInt32LE(currentOffset, 42);
        nameBytes.copy(cdHeader, 46);

        cdHeaders.push(cdHeader);
        parts.push(localHeader);
        parts.push(compressed);
        currentOffset += localHeader.length + compressed.length;
    }

    const cdOffset = currentOffset;
    let cdSize = 0;
    for (const cdh of cdHeaders) {
        parts.push(cdh);
        cdSize += cdh.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);
    parts.push(eocd);
    const combined = Buffer.concat(parts);
    return new Uint8Array(combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength));
}

// ===================================================================
// TEST SUITE 1: CSV / TSV ADVERSARIAL STRESS TESTS
// ===================================================================
async function testCsvTsvAdversarial() {
    console.log('\n--- Running Suite 1: CSV/TSV Adversarial Stress Tests ---');

    // 1.1 Unclosed quotes
    {
        const unclosedMid = 'Name,Age,City\nAlice,"30,New York\nBob,25,Paris';
        const rows = parseCsv(unclosedMid);
        stressAssert(Array.isArray(rows) && rows.length > 0, 'parseCsv does not crash on unclosed quote mid-file');
        const chunks = chunkTabularData(unclosedMid, 'unclosed.csv');
        stressAssert(Array.isArray(chunks) && chunks.length > 0, 'chunkTabularData does not crash on unclosed quote mid-file');

        const unclosedEof = 'Name,Age,City\nAlice,30,"New York';
        const rowsEof = parseCsv(unclosedEof);
        stressAssert(rowsEof.length === 2, 'parseCsv handles unclosed quote at EOF', { rowsEof });
        stressAssert(rowsEof[1][2] === 'New York', 'parseCsv extracts value before unclosed EOF quote', { val: rowsEof[1]?.[2] });

        const singleQuote = '"';
        const rowsSingle = parseCsv(singleQuote);
        stressAssert(Array.isArray(rowsSingle), 'parseCsv handles single quote string without error');

        const unclosedHeader = '"Name,Age,City\nAlice,30,Paris';
        const chunksUnclosedHeader = chunkTabularData(unclosedHeader, 'unclosed_header.csv');
        stressAssert(Array.isArray(chunksUnclosedHeader) && chunksUnclosedHeader.length > 0, 'chunkTabularData handles unclosed quote in header row gracefully');
    }

    // 1.2 Escaped quotes inside quotes ("""hello""")
    {
        // In RFC 4180: """hello""" in CSV represents the literal string "hello"
        const csvTriple = 'ID,Greeting\n1,"""hello"""';
        const rowsTriple = parseCsv(csvTriple);
        stressAssert(rowsTriple.length === 2, 'parseCsv parses row with """hello"""');
        stressAssert(rowsTriple[1][1] === '"hello"', '"""hello""" correctly unescapes to "hello"', { actual: rowsTriple[1]?.[1] });

        // Multiple escaped quotes in sentence
        const csvMulti = 'ID,Text\n1,"She said, ""Yes!"", and ""Amen!"""';
        const rowsMulti = parseCsv(csvMulti);
        stressAssert(rowsMulti[1][1] === 'She said, "Yes!", and "Amen!"', 'Multiple escaped quotes inside sentence unescape correctly', { actual: rowsMulti[1]?.[1] });

        // Quadruple quotes """" -> single literal quote "
        const csvQuad = 'Col\n""""';
        const rowsQuad = parseCsv(csvQuad);
        stressAssert(rowsQuad[1][0] === '"', '"""" unescapes to single literal double quote', { actual: rowsQuad[1]?.[0] });

        // Empty quotes "" -> empty string
        const csvEmptyQuoted = 'Col\n""';
        const rowsEmpty = parseCsv(csvEmptyQuoted);
        stressAssert(rowsEmpty[1][0] === '', '"" unescapes to empty string', { actual: rowsEmpty[1]?.[0] });
    }

    // 1.3 Multiline quoted cells with \r\n and \n
    {
        // Multiline with \r\n
        const multilineCrlf = 'ID,Details\r\n1,"Line 1\r\nLine 2\r\nLine 3"\r\n2,Next';
        const rowsCrlf = parseCsv(multilineCrlf);
        stressAssert(rowsCrlf.length === 3, 'parseCsv correctly parses 3 rows with multiline CRLF cell', { count: rowsCrlf.length });
        stressAssert(rowsCrlf[1][1].includes('Line 1') && rowsCrlf[1][1].includes('Line 3'), 'CRLF multiline content preserved');
        stressAssert(rowsCrlf[2][0] === '2' && rowsCrlf[2][1] === 'Next', 'Row following CRLF multiline cell is intact');

        // Multiline with \n
        const multilineLf = 'ID,Details\n1,"Line A\nLine B"\n2,After';
        const rowsLf = parseCsv(multilineLf);
        stressAssert(rowsLf.length === 3, 'parseCsv correctly parses 3 rows with multiline LF cell');

        // Verify chunkTabularData converts newlines within cell values to spaces
        const chunksCrlf = chunkTabularData(multilineCrlf, 'multi.csv');
        stressAssert(chunksCrlf.length === 1, 'chunkTabularData groups multiline rows cleanly');
        // Chunk should not have extra lines from the multiline cell breaking the row format
        const chunkLines = chunksCrlf[0].split('\n');
        stressAssert(chunkLines.length === 2, 'chunkTabularData flattens multiline cells into single row line', { lineCount: chunkLines.length, chunk: chunksCrlf[0] });
        stressAssert(chunkLines[0].includes('Details: Line 1 Line 2 Line 3'), 'Multiline cell replaced with space-separated string', { line: chunkLines[0] });
    }

    // 1.4 Tab-delimited files (TSV): trailing tabs, empty cells, delimiter conflicts
    {
        // Trailing tabs
        const tsvTrailing = 'Col1\tCol2\tCol3\t\t\nVal1\tVal2\tVal3\t\t\n';
        const rowsTrailing = parseCsv(tsvTrailing, '\t');
        stressAssert(rowsTrailing.length === 2, 'parseCsv parses TSV with trailing tabs into 2 rows', { length: rowsTrailing.length });
        stressAssert(rowsTrailing[0][0] === 'Col1' && rowsTrailing[0][2] === 'Col3', 'TSV trailing tab columns indexed properly');
        stressAssert(rowsTrailing[1][0] === 'Val1' && rowsTrailing[1][2] === 'Val3', 'TSV trailing tab values aligned');

        // Empty cells in middle
        const tsvEmptyMiddle = 'Col1\tCol2\tCol3\nVal1\t\tVal3\n\tValB\t';
        const rowsEmpty = parseCsv(tsvEmptyMiddle, '\t');
        stressAssert(rowsEmpty[1][0] === 'Val1' && rowsEmpty[1][1] === '' && rowsEmpty[1][2] === 'Val3', 'TSV empty middle cell preserved as empty string', { row1: rowsEmpty[1] });
        stressAssert(rowsEmpty[2][0] === '' && rowsEmpty[2][1] === 'ValB', 'TSV leading empty cell preserved', { row2: rowsEmpty[2] });

        // Chunking with empty cells: verify alignment in chunk
        const chunksEmpty = chunkTabularData(tsvEmptyMiddle, 'empty.tsv', '', { delimiter: '\t' });
        stressAssert(chunksEmpty.length === 1, 'chunkTabularData processes TSV with empty cells');
        stressAssert(chunksEmpty[0].includes('Col1: Val1 | Col3: Val3'), 'Empty cell omitted from formatted row without misaligning other columns', { chunk: chunksEmpty[0] });
        stressAssert(!chunksEmpty[0].includes('Col2: Val3'), 'Val3 is NOT wrongly attributed to Col2');

        // Delimiter auto-detection on TSV extension
        stressAssert(detectDelimiter('a\tb\tc\n1\t2\t3', 'test.tsv') === '\t', 'detectDelimiter returns tab for .tsv extension');
        stressAssert(detectDelimiter('a\tb\tc\n1\t2\t3', 'test.tab') === '\t', 'detectDelimiter returns tab for .tab extension');

        // Delimiter conflict: file has no extension but content has tabs
        const tabContentNoExt = 'Name\tAge\tScore\nAlice\t30\t100\nBob\t25\t95';
        stressAssert(detectDelimiter(tabContentNoExt, '') === '\t', 'detectDelimiter picks tab when frequency dominates without extension');

        // Delimiter conflict: CSV file that contains tabs and no commas
        const tabInCsv = 'Col1\tCol2\nVal1\tVal2';
        const detectedDelim = detectDelimiter(tabInCsv, 'data.csv');
        // Note: detectDelimiter for .csv checks counts[';'] > counts[','] ? ';' : ','
        // Let's document what happens here
        console.log(`     [Notice] Delimiter for data.csv with tabs: "${detectedDelim}"`);
    }

    // 1.5 Header preservation in every chunk
    {
        const headers = 'EmployeeID,Name,Department,Salary,Location';
        const dataRows = [];
        for (let i = 1; i <= 15; i++) {
            dataRows.push(`EMP${i},Person_${i},Engineering,$${100000 + i * 1000},City_${i}`);
        }
        const fullCsv = [headers, ...dataRows].join('\n');

        const chunks = chunkTabularData(fullCsv, 'employees.csv', '', { maxRowsPerChunk: 3 });
        stressAssert(chunks.length === 5, '15 rows chunked into 5 chunks of 3 rows each', { chunkCount: chunks.length });

        let allChunksPreserveHeaders = true;
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const lines = chunk.split('\n');
            for (let j = 0; j < lines.length; j++) {
                const line = lines[j];
                const hasEmpId = line.includes('EmployeeID:');
                const hasName = line.includes('Name:');
                const hasDept = line.includes('Department:');
                const hasSalary = line.includes('Salary:');
                const hasLoc = line.includes('Location:');
                if (!hasEmpId || !hasName || !hasDept || !hasSalary || !hasLoc) {
                    allChunksPreserveHeaders = false;
                    console.error(`     ❌ Chunk ${i} line ${j} missing headers: "${line}"`);
                }
            }
        }
        stressAssert(allChunksPreserveHeaders, 'EVERY line of EVERY chunk strictly preserves all column headers');

        // Single-column CSV: header preservation
        const singleColCsv = 'Task\nTask1\nTask2\nTask3';
        const singleColChunks = chunkTabularData(singleColCsv, 'tasks.csv', '', { maxRowsPerChunk: 2 });
        stressAssert(singleColChunks.length === 2, 'Single-column CSV chunked');
        const singleLines = singleColChunks[0].split('\n');
        stressAssert(singleLines[0].includes('Task: Task1'), 'Single column header preserved on row 1', { line: singleLines[0] });
        stressAssert(singleLines[1].includes('Task: Task2'), 'Single column header preserved on row 2', { line: singleLines[1] });

        // Ragged rows: data row has more columns than headers
        const raggedCsv = 'A,B\n1,2,3,4\n5,6';
        const raggedChunks = chunkTabularData(raggedCsv, 'ragged.csv');
        stressAssert(raggedChunks[0].includes('Column_3: 3') && raggedChunks[0].includes('Column_4: 4'), 'Synthetic headers Column_N generated for surplus columns', { chunk: raggedChunks[0] });
    }
}

// ===================================================================
// TEST SUITE 2: XLSX ADVERSARIAL STRESS TESTS
// ===================================================================
async function testXlsxAdversarial() {
    console.log('\n--- Running Suite 2: XLSX Adversarial Stress Tests ---');

    // 2.1 Synthetic ZIP buffers: corrupted zip headers, truncated central directory, garbage
    {
        // 2.1.1 Empty / zero-byte buffer
        const emptyResult = await extractXlsxText(new ArrayBuffer(0), 'empty.xlsx');
        stressAssert(emptyResult === null, 'extractXlsxText returns null on zero-length ArrayBuffer');

        // 2.1.2 Buffer under 30 bytes
        const shortBuffer = new ArrayBuffer(20);
        const shortResult = await extractXlsxText(shortBuffer, 'short.xlsx');
        stressAssert(shortResult === null, 'extractXlsxText returns null on <30 byte buffer');

        // 2.1.3 Corrupted local header magic
        const baseZip = buildZipBuffer([
            { name: 'xl/workbook.xml', content: '<workbook/>' }
        ]);
        const corruptedMagic = Buffer.from(baseZip);
        corruptedMagic[0] = 0x00;
        corruptedMagic[1] = 0x00;
        // Central directory is still valid, so readZipEntries tries to read local headers
        const corruptedResult = await extractXlsxText(corruptedMagic.buffer, 'corrupted_magic.xlsx');
        stressAssert(corruptedResult === null, 'extractXlsxText returns null on corrupted magic header without crashing');

        // 2.1.4 Truncated central directory (truncate EOCD/central directory)
        const truncatedZip = baseZip.subarray(0, baseZip.length - 35);
        const truncatedResult = await extractXlsxText(truncatedZip.buffer, 'truncated.xlsx');
        stressAssert(truncatedResult === null, 'extractXlsxText returns null on truncated ZIP buffer');

        // 2.1.5 Pure random garbage buffer
        const garbage = Buffer.alloc(1024);
        for (let i = 0; i < 1024; i++) garbage[i] = (Math.random() * 256) | 0;
        const garbageResult = await extractXlsxText(garbage.buffer, 'garbage.xlsx');
        stressAssert(garbageResult === null, 'extractXlsxText returns null on 1KB random garbage buffer');

        // 2.1.6 Invalid compressed stream: method 8 with invalid deflate stream
        const invalidDeflateZip = buildZipBuffer([
            { name: 'xl/workbook.xml', content: 'fake content', method: 0 }
        ]);
        // Overwrite method to 8 so it tries to inflateRaw plain text
        const zipBytes = Buffer.from(invalidDeflateZip);
        // Local header method offset is 8
        zipBytes.writeUInt16LE(8, 8);
        // CD header method offset
        for (let i = 0; i < zipBytes.length - 4; i++) {
            if (zipBytes.readUInt32LE(i) === 0x02014b50) {
                zipBytes.writeUInt16LE(8, i + 10);
            }
        }
        const invalidDeflateResult = await extractXlsxText(zipBytes.buffer, 'invalid_deflate.xlsx');
        stressAssert(invalidDeflateResult === null, 'extractXlsxText returns null on invalid deflate stream without crashing');
    }

    // 2.2 Missing shared strings table
    {
        const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="NumbersOnly" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

        const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

        const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="str"><v>Metric</v></c>
      <c r="B1" t="str"><v>Score</v></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>Latency</t></is></c>
      <c r="B2"><v>42</v></c>
    </row>
    <row r="3">
      <c r="A3" t="s"><v>0</v></c>
      <c r="B3"><v>99</v></c>
    </row>
  </sheetData>
</worksheet>`;

        // Notice: NO xl/sharedStrings.xml in archive
        const zipNoStrings = buildZipBuffer([
            { name: 'xl/workbook.xml', content: workbookXml },
            { name: 'xl/_rels/workbook.xml.rels', content: relsXml },
            { name: 'xl/worksheets/sheet1.xml', content: sheet1Xml },
        ]);

        const noStringsResult = await extractXlsxText(zipNoStrings.buffer, 'nostrings.xlsx');
        stressAssert(typeof noStringsResult === 'string' && noStringsResult.length > 0, 'extractXlsxText extracts without crashing when sharedStrings.xml is missing');
        stressAssert(noStringsResult.includes('Metric: Latency | Score: 42'), 'Inline string and numeric cells extracted when shared strings missing', { noStringsResult });
        stressAssert(noStringsResult.includes('Score: 99'), 'Numeric cell on row 3 extracted despite missing shared string reference for A3');
    }

    // 2.3 Multiple worksheets with different columns
    {
        const workbookMulti = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Users" sheetId="1" r:id="rId1"/>
    <sheet name="Orders" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

        const relsMulti = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;

        const sharedStringsMulti = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="8" uniqueCount="8">
  <si><t>UserID</t></si>
  <si><t>Username</t></si>
  <si><t>Email</t></si>
  <si><t>alice</t></si>
  <si><t>alice@example.com</t></si>
  <si><t>OrderID</t></si>
  <si><t>Amount</t></si>
  <si><t>Status</t></si>
</sst>`;

        const sheetUsersXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="s"><v>2</v></c>
    </row>
    <row r="2">
      <c r="A2"><v>101</v></c>
      <c r="B2" t="s"><v>3</v></c>
      <c r="C2" t="s"><v>4</v></c>
    </row>
  </sheetData>
</worksheet>`;

        const sheetOrdersXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>5</v></c>
      <c r="B1" t="s"><v>6</v></c>
      <c r="C1" t="s"><v>7</v></c>
    </row>
    <row r="2">
      <c r="A2"><v>9001</v></c>
      <c r="B2"><v>250.75</v></c>
      <c r="C2" t="str"><v>Shipped</v></c>
    </row>
  </sheetData>
</worksheet>`;

        const zipMulti = buildZipBuffer([
            { name: 'xl/workbook.xml', content: workbookMulti },
            { name: 'xl/_rels/workbook.xml.rels', content: relsMulti },
            { name: 'xl/sharedStrings.xml', content: sharedStringsMulti },
            { name: 'xl/worksheets/sheet1.xml', content: sheetUsersXml },
            { name: 'xl/worksheets/sheet2.xml', content: sheetOrdersXml },
        ]);

        const multiResult = await extractXlsxText(zipMulti.buffer, 'database.xlsx');
        stressAssert(multiResult.includes('[Table: database.xlsx > Users]'), 'Contains Sheet 1 banner [Table: database.xlsx > Users]');
        stressAssert(multiResult.includes('[Table: database.xlsx > Orders]'), 'Contains Sheet 2 banner [Table: database.xlsx > Orders]');
        stressAssert(multiResult.includes('UserID: 101 | Username: alice | Email: alice@example.com'), 'Sheet 1 columns and values extracted accurately');
        stressAssert(multiResult.includes('OrderID: 9001 | Amount: 250.75 | Status: Shipped'), 'Sheet 2 columns and values extracted accurately');

        // Split into paragraphs router test
        const routedMulti = splitIntoParagraphs(multiResult, 'xlsx', 'database.xlsx');
        stressAssert(routedMulti.length === 2, 'splitIntoParagraphs splits multi-sheet XLSX into separate sheet paragraphs', { length: routedMulti.length });
        stressAssert(routedMulti[0].includes('> Users'), 'Paragraph 1 contains Users sheet');
        stressAssert(routedMulti[1].includes('> Orders'), 'Paragraph 2 contains Orders sheet');
    }

    // 2.4 Cell coordinate mapping beyond Z (AA, AB, BZ, AAA, XFD)
    {
        // Test colLettersToIndex directly
        stressAssert(colLettersToIndex('A') === 0, 'colLettersToIndex("A") === 0');
        stressAssert(colLettersToIndex('Z') === 25, 'colLettersToIndex("Z") === 25');
        stressAssert(colLettersToIndex('AA') === 26, 'colLettersToIndex("AA") === 26');
        stressAssert(colLettersToIndex('AB') === 27, 'colLettersToIndex("AB") === 27');
        stressAssert(colLettersToIndex('AZ') === 51, 'colLettersToIndex("AZ") === 51');
        stressAssert(colLettersToIndex('BA') === 52, 'colLettersToIndex("BA") === 52');
        stressAssert(colLettersToIndex('BZ') === 77, 'colLettersToIndex("BZ") === 77');
        stressAssert(colLettersToIndex('ZZ') === 701, 'colLettersToIndex("ZZ") === 701');
        stressAssert(colLettersToIndex('AAA') === 702, 'colLettersToIndex("AAA") === 702');
        stressAssert(colLettersToIndex('XFD') === 16383, 'colLettersToIndex("XFD") === 16383 (max Excel col)');

        // Case insensitivity
        stressAssert(colLettersToIndex('aa') === 26, 'colLettersToIndex("aa") === 26 (case-insensitive)');
        stressAssert(colLettersToIndex('bz') === 77, 'colLettersToIndex("bz") === 77 (case-insensitive)');

        // Test in parseWorksheetRows with sparse far-right cells
        const sparseSheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="str"><v>ColA</v></c>
      <c r="AA1" t="str"><v>ColAA</v></c>
      <c r="BZ1" t="str"><v>ColBZ</v></c>
    </row>
    <row r="2">
      <c r="A2"><v>1</v></c>
      <c r="AA2"><v>27</v></c>
      <c r="BZ2"><v>78</v></c>
    </row>
  </sheetData>
</worksheet>`;

        const rowsSparse = parseWorksheetRows(sparseSheetXml);
        stressAssert(rowsSparse.length === 2, 'parseWorksheetRows parses sparse rows beyond Z');
        stressAssert(rowsSparse[0][0] === 'ColA', 'Cell A1 at index 0');
        stressAssert(rowsSparse[0][26] === 'ColAA', 'Cell AA1 at index 26', { val: rowsSparse[0][26] });
        stressAssert(rowsSparse[0][77] === 'ColBZ', 'Cell BZ1 at index 77', { val: rowsSparse[0][77] });
        stressAssert(rowsSparse[1][0] === '1' && rowsSparse[1][26] === '27' && rowsSparse[1][77] === '78', 'Sparse values aligned with beyond-Z headers');

        // Verify chunkTabularData on sparse rows omits intermediate empty columns
        const sparseChunks = chunkTabularData(rowsSparse, 'sparse.xlsx');
        stressAssert(sparseChunks.length === 1, 'chunkTabularData formats sparse rows');
        stressAssert(sparseChunks[0].includes('ColA: 1 | ColAA: 27 | ColBZ: 78'), 'Sparse columns formatted cleanly without hundreds of empty headers', { chunk: sparseChunks[0] });
    }

    // 2.5 Empty rows, numeric formatting, inline strings vs shared strings
    {
        const mixedTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="str"><v>Label</v></c>
      <c r="B1" t="str"><v>Value</v></c>
    </row>
    <row r="2"></row>
    <row r="3"/>
    <row r="4">
      <c r="A4" t="inlineStr"><is><t>Integer</t></is></c>
      <c r="B4"><v>12345</v></c>
    </row>
    <row r="5">
      <c r="A5" t="inlineStr"><is><t>Float</t></is></c>
      <c r="B5"><v>3.14159</v></c>
    </row>
    <row r="6">
      <c r="A6" t="inlineStr"><is><t>Scientific</t></is></c>
      <c r="B6"><v>1.25e-4</v></c>
    </row>
    <row r="7">
      <c r="A7" t="inlineStr"><is><t>BooleanTrue</t></is></c>
      <c r="B7" t="b"><v>1</v></c>
    </row>
    <row r="8">
      <c r="A8" t="inlineStr"><is><t>BooleanFalse</t></is></c>
      <c r="B8" t="b"><v>0</v></c>
    </row>
    <row r="9">
      <c r="A9" t="inlineStr"><is><t>ErrorVal</t></is></c>
      <c r="B9" t="e"><v>#N/A</v></c>
    </row>
  </sheetData>
</worksheet>`;

        const mixedRows = parseWorksheetRows(mixedTypesXml);
        stressAssert(mixedRows.length === 7, 'Empty rows <row r="2"></row> and <row r="3"/> are skipped, 7 rows returned', { length: mixedRows.length });
        stressAssert(mixedRows[1][1] === '12345', 'Integer value preserved');
        stressAssert(mixedRows[2][1] === '3.14159', 'Floating point value preserved');
        stressAssert(mixedRows[3][1] === '1.25e-4', 'Scientific notation preserved');
        stressAssert(mixedRows[4][1] === 'TRUE', 'Boolean 1 converted to TRUE');
        stressAssert(mixedRows[5][1] === 'FALSE', 'Boolean 0 converted to FALSE');
        stressAssert(mixedRows[6][1] === '#N/A', 'Error cell value #N/A preserved');
    }
}

// ===================================================================
// RUN ALL TESTS & PRINT REPORT
// ===================================================================
async function runAll() {
    console.log('====================================================');
    console.log('CHALLENGER 1: Empirical Adversarial Tabular Test Suite');
    console.log('====================================================');

    await testCsvTsvAdversarial();
    await testXlsxAdversarial();

    console.log('\n====================================================');
    console.log(`Results: ${passedAssertions} passed, ${failedAssertions} failed`);
    console.log('====================================================');

    if (failedAssertions > 0) {
        console.log(`\n⚠️  ${failedAssertions} FAILURE(S) DETECTED:`);
        for (const f of findings) {
            console.log(` - ${f.message}`);
        }
        process.exit(1);
    } else {
        console.log('✅ ALL ADVERSARIAL STRESS TESTS PASSED!');
        process.exit(0);
    }
}

runAll().catch(e => {
    console.error('Test runner fatal crash:', e);
    process.exit(1);
});
