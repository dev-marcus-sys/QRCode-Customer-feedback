/**
 * AI-09 RAG 知識庫（docs/AI_利用方案.md §4.9）。
 *
 * 職責：
 *  - Ingest：wiki／Markdown 文件 → 按標題結構分塊 → embedding → 存 kb_document / kb_chunk。
 *  - Search：問題 → embedding → 同模型暴力 cosine top-k（帶章節來源）。
 *  - Ask：檢索結果注入 LLM 生成附引用答案；無 LLM／關閉時回落「檢索片段」清單（仍附來源）。
 *
 * 私隱與治理：
 *  - 文件入庫前須審批（status：pending_review→active），含 owner 與版本；更新觸發重灌對應塊。
 *  - 檢索／問答寫 audit_log（action AI_KB_QUERY，只記問題 hash＋命中文件，不記答案原文）。
 *  - 向量屬敏感資料：本地 provider＝lexical（零依賴）；雲端路線 embedding 外送前內容已為公開文檔。
 *
 * 依賴（沿用 M0 橫向服務層）：
 *  - lexicalEmbed / cosine / embedRemote（aiProvider）
 *  - generateRemote（aiGenerate，生成答案用）
 *  - remoteApiOptions（aiService，組裝連線參數）
 */
'use strict';
const crypto = require('crypto');
const { getConfig } = require('../db/configStore');
const { ApiError } = require('../middlewares/error');
const { ERR } = require('../config/constants');
const logger = require('../utils/logger');
const { lexicalEmbed, cosine, embedRemote } = require('./aiProvider');
const { generateRemote } = require('./aiGenerate');
const { remoteApiOptions } = require('./aiService');

/* ====================== 配置 ====================== */
function kbConfig(db) {
  return {
    enabled: !!getConfig(db, 'ai.kb.enabled', false),
    topK: Number(getConfig(db, 'ai.kb.top_k', 5)),
    threshold: Number(getConfig(db, 'ai.kb.threshold', 0)),
    answerEnabled: !!getConfig(db, 'ai.kb.answer_enabled', false),
  };
}

/* ====================== Markdown / wiki 分塊 ====================== */
/**
 * 按標題結構切分 wiki／Markdown：每個標題（#..######）起一段，直到下一標題；
 * 保留祖先標題鏈（headingPath）作為 grounding 章節上下文；表格／列表／代碼塊不切斷。
 * @returns {Array<{heading:?string, headingPath:string[], level:?number, content:string, seq:number}>}
 */
function chunkMarkdown(md) {
  const lines = String(md || '').split(/\r?\n/);
  const chunks = [];
  const headingStack = []; // { level, text }
  let buf = [];
  let curHeading = null;
  let curLevel = null;

  const flush = () => {
    const content = buf.join('\n').trim();
    if (!content) { buf = []; return; }
    const headingPath = headingStack.map((h) => h.text);
    chunks.push({
      heading: curHeading,
      headingPath,
      level: curLevel,
      content: (curHeading ? `${'#'.repeat(curLevel)} ${curHeading}\n` : '') + content,
    });
    buf = [];
  };

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      const level = m[1].length;
      const text = m[2].trim();
      flush();
      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
      headingStack.push({ level, text });
      curHeading = text;
      curLevel = level;
      buf.push(line);
    } else {
      buf.push(line);
    }
  }
  flush();

  chunks.forEach((c, i) => { c.seq = i + 1; });
  return chunks;
}

/* ====================== 嵌入（沿用 AI-02 基礎設施） ====================== */
/**
 * 取得文本向量。provider=rules/none → 本地 lexicalEmbed（零依賴）；
 * 遠端失敗自動回落本地向量。
 * @returns {Promise<{vectors:number[][], model:string}>}
 */
async function embedTexts(db, texts) {
  const provider = getConfig(db, 'ai.provider', 'rules');
  if (provider === 'rules' || provider === 'none') {
    return { vectors: texts.map((t) => lexicalEmbed(t)), model: 'lexical' };
  }
  try {
    const r = await embedRemote(provider, texts, remoteApiOptions(db));
    return { vectors: r.vectors, model: r.model };
  } catch (e) {
    logger.warn('kb', `KB embedding 失敗，回落本地詞彙向量：${e.message}`);
    return { vectors: texts.map((t) => lexicalEmbed(t)), model: 'lexical-fallback' };
  }
}

/* ====================== 入庫 ====================== */
/**
 * 入庫（或重灌）一份知識文件。docId 重複則整份覆寫（先刪舊塊）。
 * @returns {Promise<{docId:string, chunkCount:number, model:string}>}
 */
async function ingestDocument(db, { docId, title, source, version, owner, status, content }) {
  if (!title || !String(title).trim()) throw new ApiError(ERR.VALIDATION, '知識文件標題不可空白');
  if (!content || !String(content).trim()) throw new ApiError(ERR.VALIDATION, '知識文件內容不可空白');
  const id = docId || `kb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const chunks = chunkMarkdown(content);
  if (!chunks.length) throw new ApiError(ERR.VALIDATION, '分塊後無內容，請檢查文件格式');
  const { vectors, model } = await embedTexts(db, chunks.map((c) => c.content));

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM kb_chunk WHERE doc_id = ?').run(id);
    db.prepare(
      `INSERT INTO kb_document (doc_id, title, source, version, status, owner, chunk_count, embedding_model, ingested_at, updated_at)
       VALUES (@docId, @title, @source, @version, @status, @owner, @chunkCount, @model, datetime('now'), datetime('now'))
       ON CONFLICT(doc_id) DO UPDATE SET
         title=excluded.title, source=excluded.source, version=excluded.version, status=excluded.status,
         owner=excluded.owner, chunk_count=excluded.chunk_count, embedding_model=excluded.embedding_model,
         updated_at=datetime('now')`
    ).run({
      docId: id,
      title: String(title).trim(),
      source: String(source || '').trim() || 'manual',
      version: String(version || '1').trim(),
      status: status || 'active',
      owner: owner || null,
      chunkCount: chunks.length,
      model,
    });
    const ins = db.prepare(
      'INSERT INTO kb_chunk (doc_id, seq, heading, heading_path, level, content, embedding_model, vector) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    chunks.forEach((c, i) => {
      ins.run(id, c.seq, c.heading || null, JSON.stringify(c.headingPath), c.level || null, c.content, model, JSON.stringify(vectors[i]));
    });
  });
  tx();
  logger.info('kb', `入庫知識文件 ${id}（${chunks.length} 塊，模型 ${model}）`);
  return { docId: id, chunkCount: chunks.length, model };
}

/* ====================== 檢索 ====================== */
/**
 * 檢索 top-k 相關知識塊（只比對與查詢同 embedding 模型之 active 塊）。
 * @returns {Promise<{query:string, model:string, count:number, results:Array}>}
 */
async function searchKb(db, { query, topK, threshold } = {}) {
  const cfg = kbConfig(db);
  const k = topK != null ? Number(topK) : cfg.topK;
  const th = threshold != null ? Number(threshold) : cfg.threshold;
  if (!query || !String(query).trim()) throw new ApiError(ERR.VALIDATION, '查詢不可空白');
  const { vectors: [qvec], model } = await embedTexts(db, [String(query)]);

  const rows = db.prepare(
    `SELECT c.chunk_id, c.doc_id, c.seq, c.heading, c.heading_path, c.content, c.vector, c.embedding_model,
            d.title, d.source, d.status
       FROM kb_chunk c JOIN kb_document d ON d.doc_id = c.doc_id
      WHERE d.status = 'active' AND c.embedding_model = ?`
  ).all(model);

  const scored = [];
  for (const ch of rows) {
    const vec = JSON.parse(ch.vector);
    const score = cosine(qvec, vec);
    if (score >= th) {
      scored.push({
        docId: ch.doc_id, title: ch.title, source: ch.source, seq: ch.seq,
        heading: ch.heading, headingPath: JSON.parse(ch.heading_path || '[]'),
        score: Number(score.toFixed(4)),
        snippet: String(ch.content).slice(0, 320),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return { query: String(query), model, count: Math.min(k, scored.length), results: scored.slice(0, k) };
}

/* ====================== 問答（檢索增強生成） ====================== */
function sha1(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }

/**
 * 問答：先檢索，再以 LLM 生成附引用答案；無 LLM／未啟用／無命中時回落檢索片段（仍附來源）。
 * @returns {Promise<{answer:string, model:?string, citations:Array, fallback:boolean, generated:boolean}>}
 */
async function askKb(db, { query, topK, threshold, user } = {}) {
  const cfg = kbConfig(db);
  const search = await searchKb(db, { query, topK, threshold });

  // 審計：只記問題 hash＋命中文件，不記答案原文（監察濫用）
  const hitDocs = [...new Set(search.results.map((r) => r.docId))];
  db.prepare(
    'INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    user ? user.userId : 0, user ? user.username : 'SYSTEM', 'AI_KB_QUERY', 'KB', null,
    JSON.stringify({ queryHash: sha1(query || ''), hits: hitDocs, count: search.count })
  );

  if (!search.results.length) {
    return {
      answer: '知識庫中未找到相關資料，建議查閱最新版規格書或向主管確認。',
      model: null, citations: [], fallback: true, generated: false,
    };
  }

  const provider = getConfig(db, 'ai.provider', 'rules');
  const canGenerate = cfg.answerEnabled && provider !== 'rules' && provider !== 'none';
  if (!canGenerate) {
    // 無 LLM：列出檢索片段，請人工核對後引用
    const answer = '以下為知識庫中相關段落（請人工核對後引用）：\n\n'
      + search.results.map((r, i) => `[${i + 1}] ${r.title} › ${r.headingPath.join(' › ')}（來源：${r.source}）\n${r.snippet}`).join('\n\n');
    return { answer, model: null, citations: search.results, fallback: true, generated: false };
  }

  // 有 LLM：grounded prompt，強制 [n] 引用
  const context = search.results
    .map((r, i) => `[${i + 1}]（${r.title} › ${r.headingPath.join(' › ')}；來源 ${r.source}）\n${r.content}`)
    .join('\n\n');
  const messages = [
    {
      role: 'system',
      content: '你是物業管理客戶意見處理的內部助理。只依據下方【知識庫】內容回答，並在相關句末以 [n] 標註引用編號（對應檢索段落編號）。若知識庫未涵蓋，請明確說「知識庫中無相關資料」，不得編造。回答以繁體中文、簡潔專業。',
    },
    { role: 'user', content: `【知識庫】\n${context}\n\n【問題】${query}\n\n請依知識庫回答並標註引用。` },
  ];
  try {
    const out = await generateRemote(provider, messages, { ...remoteApiOptions(db), maxTokens: 600, temperature: 0.2 });
    return { answer: out.text, model: out.model, citations: search.results, fallback: false, generated: true };
  } catch (e) {
    logger.warn('kb', `KB 生成失敗，回落檢索片段：${e.message}`);
    const answer = '（生成失敗，改列檢索片段）\n\n'
      + search.results.map((r, i) => `[${i + 1}] ${r.title} › ${r.headingPath.join(' › ')}\n${r.snippet}`).join('\n\n');
    return { answer, model: null, citations: search.results, fallback: true, generated: false };
  }
}

/* ====================== 管理 ====================== */
function normalizeDoc(r) {
  if (!r) return r;
  return {
    docId: r.doc_id,
    title: r.title,
    source: r.source,
    version: r.version,
    status: r.status,
    owner: r.owner,
    chunkCount: r.chunk_count,
    embeddingModel: r.embedding_model,
    ingestedAt: r.ingested_at,
    updatedAt: r.updated_at,
  };
}

function getKbDocument(db, docId) {
  return normalizeDoc(db.prepare('SELECT * FROM kb_document WHERE doc_id = ?').get(docId)) || null;
}

function listKbDocuments(db, { status } = {}) {
  const rows = db.prepare(
    `SELECT doc_id, title, source, version, status, owner, chunk_count, embedding_model, ingested_at, updated_at
       FROM kb_document ${status ? 'WHERE status = ?' : ''} ORDER BY updated_at DESC`
  ).all(...(status ? [status] : []));
  return rows.map(normalizeDoc);
}

function setKbDocumentStatus(db, docId, status) {
  if (!['active', 'disabled', 'pending_review'].includes(status)) {
    throw new ApiError(ERR.VALIDATION, 'status 須為 active / disabled / pending_review');
  }
  const info = db.prepare("UPDATE kb_document SET status = ?, updated_at = datetime('now') WHERE doc_id = ?").run(status, docId);
  if (!info.changes) throw new ApiError(ERR.VALIDATION, '知識文件不存在', 404);
  return getKbDocument(db, docId);
}

function deleteKbDocument(db, docId) {
  const info = db.prepare('DELETE FROM kb_document WHERE doc_id = ?').run(docId);
  return { deleted: info.changes > 0 };
}

module.exports = {
  chunkMarkdown,
  embedTexts,
  ingestDocument,
  searchKb,
  askKb,
  listKbDocuments,
  getKbDocument,
  setKbDocumentStatus,
  deleteKbDocument,
  kbConfig,
};
