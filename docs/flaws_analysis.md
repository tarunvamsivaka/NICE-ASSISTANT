# Identified Application Flaws Analysis

1. **Word Math Parser Evaluation Vulnerability**: The natural language math parser relies on regex-based string conversions before evaluation, which can fail or throw runtime errors on complex nested operator phrases.
2. **Server Origin Validation Limitation**: The local Express indexing service restricts CORS to fixed origins (`127.0.0.1:5173`), which blocks non-standard desktop or custom local WebView schemes (`file://`).
3. **Restricted File Cache Capacity**: The search engine caps its in-memory document text cache to 5 files, causing repetitive disk reading overhead during multi-file conversational follow-up queries.
4. **Platform-Dependent File System API Access**: On web clients, local file indexing depends on the Chrome-specific File System Access API, making folder selection unavailable in browsers like Firefox or mobile Safari.
5. **Static Extraction Timeout Cap**: PDF and DOCX file text extraction uses hardcoded timeouts (24 seconds for PDF, 15 seconds for DOCX), causing premature timeouts on resource-constrained mobile hardware processing heavy documents.
6. **WebGPU Hardware Dependency for On-Device LLM**: Local Small Language Model execution relies entirely on WebGPU capabilities, forcing devices without WebGPU drivers to fall back to rule-based heuristic responses.
